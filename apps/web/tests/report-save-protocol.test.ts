import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api/client";
import { isDefinitiveReportSaveError, ReportConflictError, ReportRequestError, ReportSaveUnconfirmedError, resolveReportSave, updateReport, type ReportDocument } from "@/lib/reports";

const copy = { unnamedBlock: "Block", textBlock: "Text", unnamedPage: "Page", unnamedReport: "Report" };
const document: ReportDocument = { id: "report", project_id: "project", title: "Report", description: "", status: "draft",
  version: 2, created_at: "created", updated_at: "saved", pages: [] };
afterEach(() => vi.restoreAllMocks());

it("resolves a persisted save using the exact save serializer without retrying a missing write", async () => {
  const input = { title: "  ", description: " Details ", status: "draft" as const, expected_version: 1,
    save_request_id: "c6b27cbf-5633-41ae-83a7-30fef16b2c80", pages: [] };
  const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: { data: document } });
  await updateReport("project", "report", input, copy);
  const post = vi.spyOn(api, "post").mockResolvedValueOnce({ data: { data: null } }).mockResolvedValueOnce({ data: { data: document } });
  expect(await resolveReportSave("project", "report", structuredClone(input), structuredClone(copy))).toBeNull();
  expect(post).toHaveBeenLastCalledWith("/api/v1/projects/project/reports/report/save-receipts/resolve", patch.mock.calls[0][1]);
  expect(await resolveReportSave("project", "report", input, copy)).toEqual(document);
  expect(patch).toHaveBeenCalledTimes(1);
});

it("sends the report-save request identity and retry flag without serializing local entity IDs", async () => {
  const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: { data: document } });
  const result = await updateReport("project", "report", { title: "Title", description: "", status: "draft", expected_version: 1,
    save_request_id: "c6b27cbf-5633-41ae-83a7-30fef16b2c80", retry_save: true,
    pages: [{ id: "local-page-1", title: "Page", order_index: 0, config: {}, blocks: [] }] }, copy);
  expect(patch.mock.calls[0][1]).toMatchObject({ save_request_id: "c6b27cbf-5633-41ae-83a7-30fef16b2c80", retry_save: true, expected_version: 1 });
  expect((patch.mock.calls[0][1] as { pages: object[] }).pages[0]).not.toHaveProperty("id");
  expect(result.version).toBe(2);
});

it("separates an unconfirmed save from an ordinary conflict or definitive validation failure", async () => {
  const patch = vi.spyOn(api, "patch");
  const input = { title: "Title", description: "", status: "draft" as const, expected_version: 1, pages: [] };
  patch.mockRejectedValueOnce({ response: { status: 409, data: { detail: { code: "report_save_unconfirmed" } } } });
  await expect(updateReport("project", "report", input, copy)).rejects.toBeInstanceOf(ReportSaveUnconfirmedError);
  patch.mockRejectedValueOnce({ response: { status: 422, data: {} } });
  let failure: unknown;
  try { await updateReport("project", "report", input, copy); } catch (error) { failure = error; }
  expect(isDefinitiveReportSaveError(failure)).toBe(true);
  expect(isDefinitiveReportSaveError(new ReportConflictError())).toBe(true);
  for (const error of [new ReportSaveUnconfirmedError(), new Error("network"), new ReportRequestError("save_report_failed", undefined, 500), new ReportRequestError("save_report_failed", undefined, 408)]) {
    expect(isDefinitiveReportSaveError(error)).toBe(false);
  }
});
