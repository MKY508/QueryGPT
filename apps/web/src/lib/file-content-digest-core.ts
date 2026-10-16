import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { FILE_DIGEST_CHUNK_BYTES } from "./file-content-digest-protocol";

function readChunk(blob: Blob, signal?: AbortSignal): Promise<ArrayBuffer> {
  // FileReader is cancellable, works in older WebViews, and yields between chunks.
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const reader = new FileReader();
    const abort = () => reader.abort();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    reader.onload = () => { cleanup(); resolve(reader.result as ArrayBuffer); };
    reader.onerror = () => { cleanup(); reject(reader.error ?? new Error("File read failed")); };
    reader.onabort = () => { cleanup(); reject(new DOMException("File read cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    try { reader.readAsArrayBuffer(blob); } catch (error) { cleanup(); reject(error); }
  });
}

/** Whole-file SHA-256 with bounded reads; never buffer the entire selected file. */
export async function digestFileChunks(file: Blob, progress?: (fraction: number) => void, signal?: AbortSignal): Promise<string> {
  const hash = sha256.create();
  try {
    signal?.throwIfAborted();
    for (let offset = 0; offset < file.size; offset += FILE_DIGEST_CHUNK_BYTES) {
      signal?.throwIfAborted();
      const end = Math.min(file.size, offset + FILE_DIGEST_CHUNK_BYTES);
      const bytes = await readChunk(file.slice(offset, end), signal);
      signal?.throwIfAborted();
      if (bytes.byteLength !== end - offset) throw new Error("Incomplete file read");
      hash.update(new Uint8Array(bytes));
      progress?.(end / file.size);
    }
    return bytesToHex(hash.digest());
  } finally { hash.destroy(); }
}
