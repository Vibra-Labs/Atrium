/** Where "Not now" on the passkey invitation is remembered, per device (passkeys belong to a device). */
export const PASSKEY_PROMPT_DISMISSED_KEY: string = "atrium.passkey-prompt-dismissed";

export interface PasskeyPromptInput {
  /** Passkeys work on this install and the user may add them (staff). */
  passkeysOffered: boolean;
  passkeyCount: number;
  onCustomDomain: boolean;
  /** "Not now" was chosen on this device. */
  dismissed: boolean;
}

/** Whether to invite the user to create a passkey: staff with none yet, who haven't said not now here. */
export function shouldOfferPasskey(input: PasskeyPromptInput): boolean {
  return input.passkeysOffered && input.passkeyCount === 0 && !input.onCustomDomain && !input.dismissed;
}

/** A name for a passkey made on this device, so the list in Settings is readable. */
export function deviceLabel(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android phone";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows PC";
  return "This device";
}
