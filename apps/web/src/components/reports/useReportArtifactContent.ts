"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { AnalysisArtifact, AnalysisArtifactSummary } from "@/lib/types/api";
import { readReportArtifact, ReportArtifactChangedError } from "@/lib/reports";

export type ArtifactContentState =
  | { status: "loading" }
  | { status: "ready"; artifact: AnalysisArtifact }
  | { status: "error"; changed: boolean };
export function artifactContentKey(item: AnalysisArtifactSummary) {
  return JSON.stringify([item.project_id, item.analysis_run_id, item.id, item.updated_at]);
}
type Job = { summary: AnalysisArtifactSummary; key: string; controller: AbortController;
  promise: Promise<AnalysisArtifact | null>; resolve: (item: AnalysisArtifact | null) => void };

/** Per-window single-flight reads. Only an explicit preview/selection queues data. */
export class ReportArtifactContentCache {
  private snapshot: ReadonlyMap<string, ArtifactContentState> = new Map();
  private listeners = new Set<() => void>();
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private running = new Set<Job>();
  private active = true;
  constructor(private projectId: string, private read = readReportArtifact) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish(key: string, value: ArtifactContentState) {
    this.snapshot = new Map(this.snapshot).set(key, value);
    this.listeners.forEach((listener) => listener());
  }
  open = () => { this.active = true; };
  close = () => {
    this.active = false;
    for (const job of this.jobs.values()) { job.controller.abort(); job.resolve(null); }
    this.queue = []; this.jobs.clear(); this.running.clear();
    this.snapshot = new Map();
  };
  load = (summary: AnalysisArtifactSummary): Promise<AnalysisArtifact | null> => {
    if (!this.active || summary.project_id !== this.projectId) return Promise.resolve(null);
    const key = artifactContentKey(summary);
    const cached = this.snapshot.get(key);
    if (cached?.status === "ready") return Promise.resolve(cached.artifact);
    const pending = this.jobs.get(key);
    if (pending) return pending.promise;
    let resolve!: Job["resolve"];
    const promise = new Promise<AnalysisArtifact | null>((done) => { resolve = done; });
    const job = { summary, key, controller: new AbortController(), promise, resolve };
    this.jobs.set(key, job); this.queue.push(job);
    this.publish(key, { status: "loading" });
    this.pump();
    return promise;
  };
  private pump() {
    while (this.active && this.running.size < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      this.running.add(job);
      void Promise.resolve().then(() => job.controller.signal.aborted ? null : this.read(job.summary, job.controller.signal))
        .then((artifact) => {
          if (!artifact || !this.active || job.controller.signal.aborted || this.jobs.get(job.key) !== job) return;
          this.jobs.delete(job.key);
          this.publish(job.key, { status: "ready", artifact });
          job.resolve(artifact);
        }).catch((error) => {
          if (!this.active || job.controller.signal.aborted || this.jobs.get(job.key) !== job) return;
          this.jobs.delete(job.key);
          this.publish(job.key, { status: "error", changed: error instanceof ReportArtifactChangedError });
          job.resolve(null);
        }).finally(() => {
          this.running.delete(job);
          if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
          this.pump();
        });
    }
  }
}

export function useReportArtifactContent(projectId: string) {
  const [cache] = useState(() => new ReportArtifactContentCache(projectId));
  const entries = useSyncExternalStore(cache.subscribe, cache.getSnapshot, cache.getSnapshot);
  useEffect(() => { cache.open(); return () => cache.close(); }, [cache]);
  return { entries, load: cache.load };
}
