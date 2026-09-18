/**
 * Copies text to the clipboard, returning whether it succeeded.
 *
 * `navigator.clipboard` is only defined in a secure context (HTTPS or
 * localhost), so self-hosted instances served over plain HTTP fall back to
 * a hidden textarea plus the legacy `document.execCommand("copy")`.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.error("Clipboard API copy failed, trying fallback", err);
  }

  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const previouslyFocused = document.activeElement as { focus?: () => void } | null;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    // iOS Safari ignores select() on its own.
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    previouslyFocused?.focus?.();
    return copied;
  } catch (err) {
    console.error("Clipboard fallback copy failed", err);
    return false;
  }
}
