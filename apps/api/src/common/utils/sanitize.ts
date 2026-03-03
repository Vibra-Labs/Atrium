/**
 * Sanitize a filename by stripping path traversal sequences and replacing
 * non-alphanumeric characters (except dot, dash, underscore, and space)
 * with underscores. Consecutive dots are collapsed to a single dot.
 * Returns "file" if the result would be empty.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, "");
  return base.replace(/[^\w.\- ]/g, "_").replace(/\.{2,}/g, ".") || "file";
}

/**
 * Build a Content-Disposition header value with both an ASCII-safe
 * `filename` parameter and an RFC 5987 `filename*` parameter for
 * non-ASCII support.
 */
export function contentDisposition(filename: string, disposition: "attachment" | "inline" = "attachment"): string {
  const safeAscii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}
