/**
 * Where an OAuth consent request will send the browser, in words a person can
 * check against what they just did.
 *
 * Client registration is anonymous, so the client-chosen name on the consent
 * screen proves nothing. The redirect URI is the one part of the request the
 * attacker cannot fake without controlling the destination, which makes it the
 * useful thing to show.
 */
export type RedirectKind = "web" | "local" | "app";

export interface RedirectDisplay {
  display: string;
  kind: RedirectKind;
}

/** Hosts that mean "a program running next to the browser", not a web site. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

const WEB_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

export function describeRedirect(uri: string): RedirectDisplay {
  if (!URL.canParse(uri)) {
    // Registration refuses unparseable URIs, so this is belt and braces —
    // and it must not echo the raw string back onto the page.
    return { display: "an unknown destination", kind: "app" };
  }
  const url = new URL(uri);
  const scheme: string = url.protocol.toLowerCase();
  if (!WEB_SCHEMES.has(scheme)) return { display: `${scheme}//`, kind: "app" };
  const host: string = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return { display: "an app on this computer", kind: "local" };
  return { display: host, kind: "web" };
}
