import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const VOICE_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Twilio-Signature",
};

export function middleware(request: NextRequest) {
  if (request.method === "OPTIONS" && request.nextUrl.pathname.startsWith("/api/voice")) {
    return new NextResponse(null, { status: 204, headers: VOICE_CORS_HEADERS });
  }

  const response = NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/voice")) {
    Object.entries(VOICE_CORS_HEADERS).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }

  return response;
}

export const config = {
  matcher: ["/api/voice/:path*"],
};
