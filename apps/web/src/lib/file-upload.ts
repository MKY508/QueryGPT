import { runtimeMessage, type RuntimeMessageKey } from "@/i18n/runtime";
import { getErrorHttpStatus } from "@/lib/types/api";
import { api } from "@/lib/api/client";

const uploadErrors: Record<string, RuntimeMessageKey> = {
  file_upload_empty: "fileUploadEmpty",
  file_upload_too_large: "fileUploadTooLarge",
  file_upload_unsupported: "fileUploadUnsupported",
  file_upload_no_space: "fileUploadNoSpace",
  file_upload_write_failed: "fileUploadWriteFailed",
  file_upload_outcome_unknown: "fileUploadOutcomeUnknown",
  file_upload_invalid: "fileUploadInvalid",
  file_upload_timeout: "fileUploadTimeout",
  file_upload_busy: "fileUploadBusy",
  file_upload_key_reused: "fileUploadRequestChanged",
  file_upload_source_removed: "fileUploadSourceRemoved",
  file_upload_content_changed: "fileUploadReselectMismatch",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Interpret only known error codes; remote messages stay diagnostic-only. */
export function fileUploadErrorKey(error: unknown): RuntimeMessageKey {
  const response = isRecord(error) ? error.response : undefined;
  const data = isRecord(response) ? response.data : undefined;
  const detail = isRecord(data) ? data.detail : undefined;
  const code = isRecord(detail) ? detail.code : undefined;
  if (typeof code === "string" && Object.hasOwn(uploadErrors, code)) {
    return uploadErrors[code];
  }
  const status = getErrorHttpStatus(error);
  if (status === 413) return "fileUploadTooLarge";
  // A timeout/disconnect or an unrecognized server failure is not proof that
  // the source was not saved. Do not encourage a blind duplicate submission.
  if (status === null || status >= 500) return "fileUploadOutcomeUnknown";
  return "requestFailedHttp";
}

export function fileUploadErrorMessage(error: unknown): string {
  return runtimeMessage(fileUploadErrorKey(error));
}

/** A null receipt is not proof that an older request has stopped. Never write here. */
export async function resolveFileUpload(projectId: string, requestId: string, sha256?: string): Promise<"added" | "removed" | null> {
  const response = await api.get(`/api/v1/projects/${projectId}/source-uploads/${requestId}`, { timeout: 20000 });
  const result: unknown = response.data?.data;
  if (result === null) return null;
  if (!isRecord(result) || result.project_id !== projectId || result.request_id !== requestId ||
    typeof result.source_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.source_id) ||
    typeof result.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(result.fingerprint) ||
    (sha256 !== undefined && result.fingerprint !== sha256) ||
    typeof result.filename !== "string" || !result.filename ||
    !Number.isSafeInteger(result.byte_size) || Number(result.byte_size) < 1 ||
    (result.status !== "added" && result.status !== "removed")) throw new Error("Unrecognized upload outcome");
  return result.status;
}
