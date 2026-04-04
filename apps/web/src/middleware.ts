import { NextRequest, NextResponse } from "next/server";

const MAIN_DOMAIN = process.env.NEXT_PUBLIC_DOMAIN ?? "";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  // Skip main domain, localhost, and internal addresses
  if (
    !MAIN_DOMAIN ||
    host === MAIN_DOMAIN ||
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("0.0.0.0")
  ) {
    return NextResponse.next();
  }

  // Custom domain: inject header so server components can read it
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-custom-host", host);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
