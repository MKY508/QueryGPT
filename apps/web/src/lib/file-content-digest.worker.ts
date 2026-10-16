import { digestFileChunks } from "./file-content-digest-core";
import type { DigestResponse } from "./file-content-digest-protocol";

// Keep worker types local: adding lib.webworker to the app's DOM globals causes conflicts.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: DigestResponse) => void;
};
let started = false;
scope.onmessage = (event) => {
  if (started) return;
  started = true;
  const request = event.data;
  if (!request || typeof request !== "object" || !("version" in request) || request.version !== 1
    || !("file" in request) || !(request.file instanceof Blob)) {
    scope.postMessage({ version: 1, type: "error" }); return;
  }
  const file = request.file;
  let lastPercent = -1;
  void digestFileChunks(file, (fraction) => {
    const percent = Math.floor(fraction * 100);
    if (percent === lastPercent) return;
    lastPercent = percent;
    scope.postMessage({ version: 1, type: "progress", loaded: Math.round(fraction * file.size), total: file.size });
  }).then((sha256) => scope.postMessage({ version: 1, type: "done", sha256 }))
    .catch(() => scope.postMessage({ version: 1, type: "error" }));
};
scope.postMessage({ version: 1, type: "ready" });
