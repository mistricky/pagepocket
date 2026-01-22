export const extensionFromContentType = (contentType?: string | null) => {
  if (!contentType) {
    return "";
  }
  if (contentType.includes("text/css")) return ".css";
  if (contentType.includes("javascript")) return ".js";
  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/gif")) return ".gif";
  if (contentType.includes("image/svg")) return ".svg";
  if (contentType.includes("font/woff2")) return ".woff2";
  if (contentType.includes("font/woff")) return ".woff";
  return "";
};

export const isTextResponse = (contentType: string) => {
  const lowered = contentType.toLowerCase();
  return (
    lowered.startsWith("text/") ||
    lowered.includes("json") ||
    lowered.includes("javascript") ||
    lowered.includes("xml") ||
    lowered.includes("svg") ||
    lowered.includes("html")
  );
};
