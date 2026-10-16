import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileContentDigest, FILE_DIGEST_CHUNK_BYTES } from "@/lib/file-content-digest";

afterEach(() => vi.restoreAllMocks());
describe("bounded file content verification", () => {
  it("matches whole-file SHA-256 across chunk boundaries and preserves input bytes", async () => {
    const bytes = Uint8Array.from({ length: FILE_DIGEST_CHUNK_BYTES * 2 + 17 }, (_, i) => i % 251);
    const file = new File([bytes], "wide.csv");
    const slice = vi.spyOn(file, "slice");
    const progress = vi.fn();
    expect(await fileContentDigest(file, progress)).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(slice.mock.calls).toEqual([[0, FILE_DIGEST_CHUNK_BYTES], [FILE_DIGEST_CHUNK_BYTES, FILE_DIGEST_CHUNK_BYTES * 2], [FILE_DIGEST_CHUNK_BYTES * 2, bytes.length]]);
    expect(progress.mock.calls.map(([fraction]) => fraction)).toEqual([FILE_DIGEST_CHUNK_BYTES / bytes.length, FILE_DIGEST_CHUNK_BYTES * 2 / bytes.length, 1]);
    expect(await fileContentDigest(new Blob([]))).toBe(createHash("sha256").digest("hex"));
  });
  it("cancels between chunks and propagates unavailable-file errors", async () => {
    const file = new File([new Uint8Array(FILE_DIGEST_CHUNK_BYTES + 1)], "orders.csv");
    const slice = vi.spyOn(file, "slice");
    const controller = new AbortController();
    await expect(fileContentDigest(file, () => controller.abort(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(slice).toHaveBeenCalledOnce();
    slice.mockImplementationOnce(() => { throw new Error("unavailable"); });
    await expect(fileContentDigest(file)).rejects.toThrow("unavailable");
  });
});
