import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AxiosError } from "axios";
import { api } from "@/lib/api/client";

/** Pydantic 验证错误项 */
interface ValidationErrorItem {
  msg: string;
  loc: string[];
  type: string;
}

/** API 错误响应 */
interface APIErrorResponse {
  detail: string | ValidationErrorItem[];
}

interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<void>;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isHydrated: false,

      setHydrated: () => set({ isHydrated: true }),

      login: async (email: string, password: string) => {
        try {
          const response = await api.post("/api/v1/auth/login", { email, password });
          const { access_token, refresh_token } = response.data.data;

          // 获取用户信息
          const userResponse = await api.get("/api/v1/auth/me", {
            headers: { Authorization: `Bearer ${access_token}` },
          });

          set({
            accessToken: access_token,
            refreshToken: refresh_token,
            user: userResponse.data.data,
            isAuthenticated: true,
          });
        } catch (error) {
          if (error instanceof AxiosError) {
            const detail = (error.response?.data as APIErrorResponse)?.detail;
            if (typeof detail === "string") {
              throw new Error(detail);
            }
          }
          throw new Error("登录失败，请检查邮箱和密码");
        }
      },

      register: async (email: string, password: string, displayName?: string) => {
        try {
          const response = await api.post("/api/v1/auth/register", {
            email,
            password,
            display_name: displayName,
          });
          const { access_token, refresh_token, user } = response.data.data;

          set({
            accessToken: access_token,
            refreshToken: refresh_token,
            user,
            isAuthenticated: true,
          });
        } catch (error) {
          if (error instanceof AxiosError) {
            const detail = (error.response?.data as APIErrorResponse)?.detail;
            if (Array.isArray(detail)) {
              // Pydantic 验证错误格式
              const msg = detail.map((d: ValidationErrorItem) => d.msg).join("; ");
              throw new Error(msg || "注册失败");
            } else if (typeof detail === "string") {
              throw new Error(detail);
            }
          }
          throw new Error("注册失败，请稍后重试");
        }
      },

      logout: () => {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        });
      },

      refreshAccessToken: async () => {
        const { refreshToken } = get();
        if (!refreshToken) {
          get().logout();
          return;
        }

        try {
          const response = await api.post("/api/v1/auth/refresh", {
            refresh_token: refreshToken,
          });
          const { access_token, refresh_token } = response.data.data;

          set({
            accessToken: access_token,
            refreshToken: refresh_token,
          });
        } catch {
          get().logout();
        }
      },
    }),
    {
      name: "querygpt-auth",
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    }
  )
);
