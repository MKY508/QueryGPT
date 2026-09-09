import type { RuntimeMessageKey } from "@/i18n/runtime";

export type UploadStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "saving"
  | "added"
  | "failed"
  | "uncertain"
  | "removed"
  | "cancelled";
export interface UploadItem {
  id: string;
  name: string;
  status: UploadStatus;
  progress: number | null;
  errorKey?: RuntimeMessageKey;
  retryable: boolean;
  checking?: boolean;
  recovered?: boolean;
  reselectable?: boolean;
  verifying?: boolean;
}
export interface UploadSnapshot {
  items: UploadItem[];
  busy: boolean;
  notice: RuntimeMessageKey | null;
  /** Hold waiting files; an active operation is allowed to finish. */
  paused?: boolean;
}
export const EMPTY_UPLOADS: UploadSnapshot = {
  items: [],
  busy: false,
  notice: null,
};
