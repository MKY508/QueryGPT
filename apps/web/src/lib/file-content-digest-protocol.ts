export const FILE_DIGEST_CHUNK_BYTES = 256 * 1024;
export const FILE_DIGEST_WORKERS = 2;
export const FILE_DIGEST_WAITING_LIMIT = 100;
export const FILE_DIGEST_START_TIMEOUT = 30_000;
export const FILE_DIGEST_IDLE_TIMEOUT = 60_000;

export type DigestRequest = { version: 1; file: Blob };
export type DigestResponse = { version: 1 } & (
  | { type: "ready" }
  | { type: "progress"; loaded: number; total: number }
  | { type: "done"; sha256: string }
  | { type: "error" }
);
