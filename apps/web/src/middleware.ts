import { NextRequest, NextResponse } from "next/server";

const MAIN_DOMAIN = process.env.NEXT_PUBLIC_DOMAIN ?? "";

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
