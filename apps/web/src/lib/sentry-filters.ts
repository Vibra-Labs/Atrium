import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Client-side noise filters for Sentry. Both patterns here come from code
 * running in the user's browser that we neither ship nor control.
 */

// Google Translate (and similar) swap React-owned text nodes for <font>
// wrappers. React then throws when it tries to remove nodes it no longer owns.
const DOM_TAMPER_MESSAGE = /Failed to execute '(removeChild|insertBefore)' on 'Node'/;
const TRANSLATED_CLASSES = ["translated-ltr", "translated-rtl"];

// Sentry rewrites every frame from our Next.js bundle to app:///_next/...
const OWN_BUNDLE = /^app:\/\/\/_next\//;
const FOREIGN_FRAME = [
  /^app:\/\/\/(?!_next\/)/, // e.g. app:///executors/200.js — injected scripts
  /^(chrome|moz|safari-web)-extension:\/\//,
  /\/extensions\//i,
];

function exceptionMessage(event: ErrorEvent): string {
  return event.exception?.values?.[0]?.value ?? "";
}

function frameFilenames(event: ErrorEvent): string[] {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return frames.map((f) => f.filename ?? "").filter((f) => f !== "");
}

function pageIsTranslated(): boolean {
  if (typeof document === "undefined") return false;
  const classList = document.documentElement.classList;
  return TRANSLATED_CLASSES.some((c) => classList.contains(c));
}

export function isTranslatorDomError(event: ErrorEvent): boolean {
  return DOM_TAMPER_MESSAGE.test(exceptionMessage(event)) && pageIsTranslated();
}

export function isForeignScriptError(event: ErrorEvent): boolean {
  const filenames = frameFilenames(event);
  if (filenames.length === 0) return false;
  if (filenames.some((f) => OWN_BUNDLE.test(f))) return false;
  return filenames.some((f) => FOREIGN_FRAME.some((re) => re.test(f)));
}

export function shouldDropClientEvent(event: ErrorEvent): boolean {
  return isTranslatorDomError(event) || isForeignScriptError(event);
}
