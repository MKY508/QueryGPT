import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock axios before importing the store
vi.mock("axios", () => ({
  default: {
    create: () => ({
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      post: vi.fn(),
      get: vi.fn(),
    }),
  },
}));

describe("Auth Store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("should have initial state", async () => {
    const { useAuthStore } = await import("@/lib/stores/auth");
    const state = useAuthStore.getState();

    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.accessToken).toBeNull();
  });

  it("should have login function", async () => {
    const { useAuthStore } = await import("@/lib/stores/auth");
    const state = useAuthStore.getState();

    expect(typeof state.login).toBe("function");
  });

  it("should have logout function", async () => {
    const { useAuthStore } = await import("@/lib/stores/auth");
    const state = useAuthStore.getState();

    expect(typeof state.logout).toBe("function");
  });

  it("should have register function", async () => {
    const { useAuthStore } = await import("@/lib/stores/auth");
    const state = useAuthStore.getState();

    expect(typeof state.register).toBe("function");
  });
});
