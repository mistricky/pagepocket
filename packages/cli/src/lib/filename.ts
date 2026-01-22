export const safeFilename = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) {
    return "snapshot";
  }
  return (
    trimmed
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "snapshot"
  );
};
