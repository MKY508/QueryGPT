import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  defaultLocale,
  localeCookieName,
  localeFromAcceptLanguage,
  resolveLocale,
} from "@/i18n/config";
import { proxy } from "@/proxy";

describe("locale resolution", () => {
  it("uses Chinese as the product default", () => {
    expect(defaultLocale).toBe("zh");
    expect(resolveLocale(undefined, undefined)).toBe("zh");
    expect(resolveLocale("invalid", "fr-FR, de;q=0.8")).toBe("zh");
  });

  it("honors quality and order for supported Accept-Language values", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,zh-CN;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("fr-FR, zh-CN;q=0.8, en;q=0.5")).toBe("zh");
    expect(localeFromAcceptLanguage("zh;q=0, en;q=0.7")).toBe("en");
  });

  it("lets an explicit supported cookie override the browser language", () => {
    expect(resolveLocale("zh", "en-US,en;q=0.9")).toBe("zh");
    expect(resolveLocale("en", "zh-CN,zh;q=0.9")).toBe("en");
  });

  it("falls back from an invalid cookie to the same browser resolution used by SSR", () => {
    expect(resolveLocale("fr", "en-GB,en;q=0.9")).toBe("en");
    expect(resolveLocale("fr", "zh-Hans-CN,zh;q=0.9")).toBe("zh");
  });

  it("persists the same browser-derived locale from the request proxy", () => {
    const response = proxy(
      new NextRequest("http://localhost/", {
        headers: { "accept-language": "en-GB,en;q=0.9,zh;q=0.5" },
      })
    );

    expect(response.cookies.get(localeCookieName)?.value).toBe("en");
  });

  it("does not replace an explicit locale cookie", () => {
    const response = proxy(
      new NextRequest("http://localhost/", {
        headers: {
          "accept-language": "zh-CN,zh;q=0.9",
          cookie: `${localeCookieName}=en`,
        },
      })
    );

    expect(response.cookies.get(localeCookieName)).toBeUndefined();
  });
});
