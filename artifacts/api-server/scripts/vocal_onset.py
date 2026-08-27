#!/usr/bin/env python3
"""Detect first vocal onset time in an audio file.

Strategy:
  1. Try faster-whisper to transcribe vocals and return the first word's
     timestamp. This is the most accurate because Whisper only transcribes
     actual sung/spoken words, ignoring instruments.
  2. If a `--lyrics-first` argument is provided, also try to find a transcribed
     word that matches the first lyric line and use THAT timestamp (handles
     songs where Whisper picks up backing vocals or "yeah"/"oh" before the
     real lyric line).
  3. Fall back to librosa harmonic-onset detection if Whisper fails.
"""
import sys
import json
import os
import re
import warnings

warnings.filterwarnings("ignore")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")


def normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9\s]", "", s.lower()).strip()


def whisper_detect(path: str, cap: float, lyrics_first: str | None, language_hint: str | None = None):
    """Return dict with vocalOnset (first word time) and transcription metadata,
    or None if Whisper unavailable / failed."""
    try:
        from faster_whisper import WhisperModel
    except Exception:
        return None

    try:
        model_size = os.environ.get("WHISPER_MODEL", "tiny")
        # Prefer the flat project-local model directory (deployed with the app)
        # so production containers don't need to download from Hugging Face Hub
        # at runtime.  Falls back to the env-var override or HF default.
        _script_dir = os.path.dirname(os.path.abspath(__file__))
        _flat_dir = os.path.join(_script_dir, "..", "models", f"whisper-{model_size}")
        _env_path = os.environ.get("WHISPER_MODEL_PATH")
        if _env_path and os.path.isdir(_env_path):
            _model_path = _env_path
        elif os.path.isfile(os.path.join(_flat_dir, "model.bin")):
            _model_path = os.path.realpath(_flat_dir)
        else:
            _model_path = model_size  # let faster_whisper download from HF Hub
        model = WhisperModel(
            _model_path,
            device="cpu",
            compute_type="int8",
        )
        # A short prompt that primes Whisper for sung lyrics improves
        # word-recall on music significantly: it sets the decoding context
        # so the model is less likely to skip or merge sung syllables.
        segments, info = model.transcribe(
            path,
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
            condition_on_previous_text=False,
            initial_prompt="Song lyrics, sung vocals, music transcription. Every word matters.",
            **({"language": language_hint} if language_hint else {}),
        )

        words = []
        for seg in segments:
            if seg.start is not None and seg.start > cap:
                break
            for w in (seg.words or []):
                if w.start is None:
                    continue
                if w.start > cap:
                    break
                txt = (w.word or "").strip()
                if not txt:
                    continue
                words.append({"word": txt, "start": float(w.start),
                              "end": float(w.end) if w.end is not None else float(w.start)})

        if not words:
            return {
                "vocalOnset": None,
                "method": "whisper",
                "reason": "no words transcribed",
                "language": getattr(info, "language", None),
            }

        first_word_time = words[0]["start"]
        matched_time = None
        matched_word = None

        if lyrics_first:
            # Try to find a transcribed word that matches the start of the first lyric line.
            target_words = normalize(lyrics_first).split()
            if target_words:
                first_target = target_words[0]
                # Look for the first transcribed word that starts with or contains the target.
                for w in words:
                    nw = normalize(w["word"])
                    if not nw:
                        continue
                    if nw == first_target or nw.startswith(first_target) or first_target.startswith(nw):
                        matched_time = w["start"]
                        matched_word = w["word"]
                        break
                # If no exact, try first 2 words concatenated.
                if matched_time is None and len(target_words) >= 2:
                    pair = " ".join(target_words[:2])
                    for i in range(len(words) - 1):
                        combo = (normalize(words[i]["word"]) + " " +
                                 normalize(words[i + 1]["word"])).strip()
                        if pair in combo or combo in pair:
                            matched_time = words[i]["start"]
                            matched_word = words[i]["word"] + " " + words[i + 1]["word"]
                            break

        chosen = matched_time if matched_time is not None else first_word_time

        return {
            "vocalOnset": float(chosen),
            "method": "whisper",
            "firstWordTime": float(first_word_time),
            "firstWord": words[0]["word"],
            "matchedTime": float(matched_time) if matched_time is not None else None,
            "matchedWord": matched_word,
            "transcript": " ".join(w["word"] for w in words[:20]),
            "wordCount": len(words),
            "words": words,
            "language": getattr(info, "language", None),
        }
    except Exception as e:
        return {"vocalOnset": None, "method": "whisper", "error": str(e)}


def librosa_detect(path: str, cap: float):
    """Fallback: librosa harmonic onset detection."""
    try:
        import numpy as np
        import librosa
    except Exception as e:
        return {"vocalOnset": None, "method": "librosa", "error": f"missing deps: {e}"}

    try:
        y, sr = librosa.load(path, sr=22050, mono=True, duration=cap)
        if y is None or len(y) == 0:
            return {"vocalOnset": None, "method": "librosa", "reason": "empty audio"}

        y_harm, _y_perc = librosa.effects.hpss(y)
        onset_env = librosa.onset.onset_strength(y=y_harm, sr=sr)
        onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, units="time")

        frame_length = max(1, int(sr * 0.2))
        hop_length = max(1, int(sr * 0.05))
        rms = librosa.feature.rms(y=y_harm, frame_length=frame_length, hop_length=hop_length)[0]
        rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
        rms_max = float(np.max(rms)) if len(rms) > 0 else 0.0
        threshold = rms_max * 0.30 if rms_max > 0 else 0.0

        def rms_at(t):
            if len(rms_times) == 0:
                return 0.0
            idx = int(np.argmin(np.abs(rms_times - t)))
            return float(rms[idx])

        all_onsets = [float(t) for t in onsets]
        qualifying = [t for t in all_onsets if rms_at(t) >= threshold and t >= 0.05]
        first_onset = qualifying[0] if qualifying else None

        return {
            "vocalOnset": first_onset,
            "method": "librosa",
            "allOnsets": all_onsets[:50],
            "harmonicRmsMax": rms_max,
            "threshold": threshold,
            "qualifyingCount": len(qualifying),
        }
    except Exception as e:
        return {"vocalOnset": None, "method": "librosa", "error": str(e)}


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"error": "usage: vocal_onset.py <audio_path> [duration_cap_sec] [--lyrics-first \"<text>\"]"}))
        return 1

    path = args[0]
    cap = 60.0
    lyrics_first = None
    language_hint = None

    i = 1
    while i < len(args):
        a = args[i]
        if a == "--lyrics-first" and i + 1 < len(args):
            lyrics_first = args[i + 1]
            i += 2
        elif a == "--language" and i + 1 < len(args):
            language_hint = args[i + 1].strip() or None
            i += 2
        else:
            try:
                cap = float(a)
            except ValueError:
                pass
            i += 1

    whisper_result = whisper_detect(path, cap, lyrics_first, language_hint)
    librosa_result = librosa_detect(path, cap)

    # Pick best result. Prefer whisper if it has a numeric vocalOnset.
    if whisper_result and whisper_result.get("vocalOnset") is not None:
        out = whisper_result
        out["librosaFallback"] = {
            "vocalOnset": librosa_result.get("vocalOnset"),
        }
    else:
        out = librosa_result
        if whisper_result is not None:
            out["whisperAttempt"] = {
                "error": whisper_result.get("error") or whisper_result.get("reason"),
            }

    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
