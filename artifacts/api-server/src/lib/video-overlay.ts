import {
  AURORA_FLUX_BLEND_MODE,
  AURORA_FLUX_BLUR_PX,
  AURORA_FLUX_COLORS,
  AURORA_FLUX_GRADIENTS,
  AURORA_FLUX_OVERLAY_OPACITY,
  AURORA_FLUX_SATURATION,
  auroraFluxDurationSeconds,
  type AuroraFluxColorName,
  type AuroraFluxGradientStop,
} from "@workspace/video-effects";

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

function escapeExpression(expression: string): string {
  // FFmpeg uses commas to separate filter options, so commas inside an
  // expression must be escaped even when the expression is quoted.
  return expression.replaceAll(",", "\\,");
}

function quotedExpression(expression: string): string {
  return `'${escapeExpression(expression)}'`;
}

function channelValue(color: AuroraFluxColorName | null, channel: 0 | 1 | 2): number {
  return color ? AURORA_FLUX_COLORS[color].rgb[channel] : 0;
}

function stopValue(stop: AuroraFluxGradientStop, channel: 0 | 1 | 2): number {
  return channelValue(stop.color, channel);
}

function gradientChannelExpression(
  progress: string,
  stops: readonly AuroraFluxGradientStop[],
  channel: 0 | 1 | 2,
): string {
  let expression = String(stopValue(stops[stops.length - 1], channel));
  for (let i = stops.length - 2; i >= 0; i--) {
    const left = stops[i];
    const right = stops[i + 1];
    const span = Math.max(0.0001, right.at - left.at);
    const interpolated = `${stopValue(left, channel)}+(${stopValue(right, channel)}-${stopValue(left, channel)})*(${progress}-${left.at.toFixed(4)})/${span.toFixed(4)}`;
    expression = `if(lt(${progress},${right.at.toFixed(4)}),${interpolated},${expression})`;
  }
  return expression;
}

function gradientOpacityExpression(
  progress: string,
  stops: readonly AuroraFluxGradientStop[],
): string {
  let expression = String(stops[stops.length - 1].opacity);
  for (let i = stops.length - 2; i >= 0; i--) {
    const left = stops[i];
    const right = stops[i + 1];
    const span = Math.max(0.0001, right.at - left.at);
    const interpolated = `${left.opacity.toFixed(4)}+(${right.opacity.toFixed(4)}-${left.opacity.toFixed(4)})*(${progress}-${left.at.toFixed(4)})/${span.toFixed(4)}`;
    expression = `if(lt(${progress},${right.at.toFixed(4)}),${interpolated},${expression})`;
  }
  return expression;
}

function ribbonProgress(
  gradient: typeof AURORA_FLUX_GRADIENTS[number],
  phaseSpeed: number,
): string {
  const angleRad = gradient.angleDeg * Math.PI / 180;
  const axisX = Math.sin(angleRad);
  const axisY = -Math.cos(angleRad);
  const extent = gradient === AURORA_FLUX_GRADIENTS[0] ? "W*1.45" : "W*1.60";
  const projected = `${axisX.toFixed(4)}*X${axisY >= 0 ? "+" : ""}${axisY.toFixed(4)}*Y`;
  return `mod(mod(${projected}+T*${phaseSpeed.toFixed(4)},${extent})+${extent},${extent})/${extent}`;
}

/**
 * Build the Aurora Flux compositing graph for FFmpeg.
 *
 * The graph intentionally stays in RGBA from the generated overlay through
 * the screen blend and masked merge. The caller owns the final output format;
 * `-pix_fmt yuv420p` must remain the final output conversion.
 */
export function buildAuroraFluxOverlayFilter(intensityPct: number, speedPct: number): string {
  const intensity = clampPercent(intensityPct) / 100;
  const period = auroraFluxDurationSeconds(speedPct);
  const alphaScale = (AURORA_FLUX_OVERLAY_OPACITY * intensity).toFixed(4);
  const firstProgress = ribbonProgress(AURORA_FLUX_GRADIENTS[0], 18 / period);
  const secondProgress = ribbonProgress(AURORA_FLUX_GRADIENTS[1], -13 / period);

  const channelExpressions = ([0, 1, 2] as const).map(channel => {
    const first = gradientChannelExpression(firstProgress, AURORA_FLUX_GRADIENTS[0].stops, channel);
    const second = gradientChannelExpression(secondProgress, AURORA_FLUX_GRADIENTS[1].stops, channel);
    return `max(${first},${second})`;
  });
  const firstOpacity = gradientOpacityExpression(firstProgress, AURORA_FLUX_GRADIENTS[0].stops);
  const secondOpacity = gradientOpacityExpression(secondProgress, AURORA_FLUX_GRADIENTS[1].stops);
  const alphaExpression = `255*${alphaScale}*max(${firstOpacity},${secondOpacity})`;

  return [
    "split=2[auroraBase][auroraSource]",
    "[auroraBase]format=gbrp,split=2[auroraBlendBase][auroraOutputBase]",
    `[auroraSource]format=gbrap,geq=r=${quotedExpression(channelExpressions[0])}:g=${quotedExpression(channelExpressions[1])}:b=${quotedExpression(channelExpressions[2])}:a=${quotedExpression(alphaExpression)},gblur=sigma=${(AURORA_FLUX_BLUR_PX / 2).toFixed(2)},eq=saturation=${AURORA_FLUX_SATURATION.toFixed(2)},format=gbrap,split=2[auroraBlend][auroraAlpha]`,
    "[auroraAlpha]alphaextract,format=gray[auroraMask]",
    `[auroraBlendBase][auroraBlend]blend=all_mode=${AURORA_FLUX_BLEND_MODE}:all_opacity=1[auroraScreened]`,
    "[auroraOutputBase][auroraScreened][auroraMask]maskedmerge,format=gbrp,format=rgba",
  ].join(";");
}
