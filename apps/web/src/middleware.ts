import { NextRequest, NextResponse } from "next/server";

// Derive the canonical hostname from WEB_URL (e.g. "https://app.example.com" → "app.example.com")
const WEB_URL = process.env.WEB_URL ?? "";
const MAIN_DOMAIN = WEB_URL ? new URL(WEB_URL).hostname : "";

// Internal hostnames that are never custom domains
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function hostname(host: string): string {
  // Strip port — "example.com:3000" → "example.com"
  return host.includes(":") ? host.split(":")[0] : host;
}

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const name = hostname(host);

  // Layouts can't see the URL, and need it to send a signed-out visitor back
  // to the page they asked for after signing in.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);

  // Custom domain: inject header so server components can read it
  if (MAIN_DOMAIN && name !== hostname(MAIN_DOMAIN) && !LOOPBACK_HOSTS.has(name)) {
    requestHeaders.set("x-custom-host", name);
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
