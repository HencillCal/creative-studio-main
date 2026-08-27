export default function OcrTool() {
  return (
    <iframe
      src="/textscan.html"
      title="OCR Text Extractor"
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
        minHeight: "calc(100vh - 64px)",
      }}
    />
  );
}
