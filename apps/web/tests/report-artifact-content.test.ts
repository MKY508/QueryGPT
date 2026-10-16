import { describe, expect, it, vi } from "vitest";
import { ReportArtifactContentCache, artifactContentKey } from "@/components/reports/useReportArtifactContent";
import { ReportArtifactChangedError, readReportArtifact } from "@/lib/reports";
import { api } from "@/lib/api/client";
import type { AnalysisArtifact } from "@/lib/types/api";

const item = (id: string): AnalysisArtifact => ({ id, project_id: "p", analysis_run_id: "r", kind: "table", title: id,
  payload: { rows: [{ amount: "9007199254740993.25" }] }, technical_details: {}, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe("lazy report artifact reads", () => {
  it("starts no reads until asked, coalesces readers and caps concurrent content reads at two", async () => {
    const pending = [deferred<AnalysisArtifact>(), deferred<AnalysisArtifact>(), deferred<AnalysisArtifact>()];
    const read = vi.fn((_summary, _signal) => pending[read.mock.calls.length - 1].promise);
    const cache = new ReportArtifactContentCache("p", read);
    expect(read).not.toHaveBeenCalled();
    const first = cache.load(item("1"));
    expect(cache.load(item("1"))).toBe(first);
    const second = cache.load(item("2")), third = cache.load(item("3"));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    pending[0].resolve(item("1"));
    expect(await first).toEqual(item("1"));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    pending[1].resolve(item("2")); pending[2].resolve(item("3"));
    await Promise.all([second, third]);
    expect(await cache.load(item("1"))).toEqual(item("1"));
    expect(read).toHaveBeenCalledTimes(3);
    cache.close();
  });

  it("keeps failures retryable and aborts running and queued work without publishing late results", async () => {
    const late = deferred<AnalysisArtifact>();
    const read = vi.fn().mockRejectedValueOnce(new ReportArtifactChangedError()).mockImplementation(() => late.promise);
    const cache = new ReportArtifactContentCache("p", read);
    expect(await cache.load(item("1"))).toBeNull();
    expect(cache.getSnapshot().get(artifactContentKey(item("1")))).toEqual({ status: "error", changed: true });
    const promises = [cache.load(item("1")), cache.load(item("2")), cache.load(item("3"))];
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    const signals = read.mock.calls.slice(1).map((call) => call[1] as AbortSignal);
    cache.close();
    expect(await Promise.all(promises)).toEqual([null, null, null]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    late.resolve(item("1"));
    await late.promise;
    expect(cache.getSnapshot().size).toBe(0);
    expect(read).toHaveBeenCalledTimes(3);
    expect(await cache.load({ ...item("x"), project_id: "foreign" })).toBeNull();
  });

  it("pins the directory timestamp and rejects a mismatched content identity", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: { data: item("1") } });
    const signal = new AbortController().signal;
    try {
      expect(await readReportArtifact(item("1"), signal)).toEqual(item("1"));
      expect(get).toHaveBeenCalledWith("/api/v1/projects/p/analysis-runs/r/report-artifacts/1", { signal, params: { expected_updated_at: item("1").updated_at } });
      get.mockResolvedValueOnce({ data: { data: item("2") } });
      await expect(readReportArtifact(item("1"))).rejects.toBeInstanceOf(ReportArtifactChangedError);
    } finally { get.mockRestore(); }
  });
});
