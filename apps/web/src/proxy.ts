import { NextRequest, NextResponse } from "next/server";
import {
  isLocale,
  localeCookieName,
  resolveLocale,
} from "./i18n/config";

export function proxy(request: NextRequest) {
  const localeCookie = request.cookies.get(localeCookieName)?.value;

  if (isLocale(localeCookie)) {
    return NextResponse.next();
  }

  const detectedLocale = resolveLocale(
    localeCookie,
    request.headers.get("accept-language")
  );

  const response = NextResponse.next();
  response.cookies.set(localeCookieName, detectedLocale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
