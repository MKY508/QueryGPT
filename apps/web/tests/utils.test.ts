import { describe, it, expect } from "vitest";
import { getErrorMessage } from "@/lib/types/api";

describe("getErrorMessage", () => {
  it("should return message from Error object", () => {
    const error = new Error("Test error message");
    expect(getErrorMessage(error)).toBe("Test error message");
  });

  it("should return string directly", () => {
    expect(getErrorMessage("String error")).toBe("String error");
  });

  it("should return default message for unknown types", () => {
    expect(getErrorMessage(null)).toBe("未知错误");
    expect(getErrorMessage(undefined)).toBe("未知错误");
    expect(getErrorMessage(123)).toBe("未知错误");
    expect(getErrorMessage({})).toBe("未知错误");
  });
});

describe("Basic utilities", () => {
  it("should handle empty arrays", () => {
    const arr: string[] = [];
    expect(arr.length).toBe(0);
  });

  it("should handle object spread", () => {
    const obj1 = { a: 1 };
    const obj2 = { b: 2 };
    const merged = { ...obj1, ...obj2 };
    expect(merged).toEqual({ a: 1, b: 2 });
  });
});
