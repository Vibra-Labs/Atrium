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

  if (!MAIN_DOMAIN || name === hostname(MAIN_DOMAIN) || LOOPBACK_HOSTS.has(name)) {
    return NextResponse.next();
  }

  // Custom domain: inject header so server components can read it
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-custom-host", name);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
