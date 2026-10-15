import { hashId } from "./hash";
import { ENGINE_VERSION } from "./types";

export type JobStatus = "running" | "done" | "failed" | "cancelled";

export interface Job<T = unknown> {
  id: string;
  kind: string;
  status: JobStatus;
  progress: number;       // 0..1
  result?: T;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface JobContext {
  progress: (p: number) => void;
  cancelled: () => boolean;
  /** Yield to the browser so the UI stays responsive; throws if the job was cancelled. */
  tick: () => Promise<void>;
}

export class JobCancelled extends Error { constructor() { super("Job cancelled"); } }

const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Cooperative in-thread job queue. Ids are hashes of kind + input + engine version, so submitting
 * identical work returns the existing job (idempotent) and its cached result.
 */
export class JobManager {
  private jobs = new Map<string, Job>();
  private cancelFlags = new Set<string>();
  private listeners = new Set<() => void>();
  private version = 0;

  idFor(kind: string, input: unknown) { return hashId({ kind, input, engine: ENGINE_VERSION }); }

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getVersion = () => this.version;
  private emit() { this.version++; this.listeners.forEach((l) => l()); }

  get<T>(id: string): Job<T> | undefined { return this.jobs.get(id) as Job<T> | undefined; }
  list(): Job[] { return [...this.jobs.values()]; }

  cancel(id: string) {
    const j = this.jobs.get(id);
    if (j?.status === "running") this.cancelFlags.add(id);
  }

  /** Returns the job id immediately; await `wait(id)` for the result. */
  submit<T>(kind: string, input: unknown, run: (ctx: JobContext) => Promise<T>): string {
    const id = this.idFor(kind, input);
    const existing = this.jobs.get(id);
    if (existing && (existing.status === "running" || existing.status === "done")) return id;

    const job: Job<T> = { id, kind, status: "running", progress: 0, startedAt: Date.now() };
    this.jobs.set(id, job);
    this.cancelFlags.delete(id);
    this.promises.set(id, (async () => {
      const ctx: JobContext = {
        progress: (p) => { job.progress = Math.max(0, Math.min(1, p)); this.emit(); },
        cancelled: () => this.cancelFlags.has(id),
        tick: async () => { await yieldNow(); if (this.cancelFlags.has(id)) throw new JobCancelled(); },
      };
      try {
        await yieldNow();
        job.result = await run(ctx);
        job.status = "done"; job.progress = 1;
      } catch (e) {
        if (e instanceof JobCancelled) job.status = "cancelled";
        else { job.status = "failed"; job.error = (e as Error).message; }
      } finally {
        job.finishedAt = Date.now();
        this.emit();
      }
    })());
    this.emit();
    return id;
  }

  private promises = new Map<string, Promise<void>>();
  async wait<T>(id: string): Promise<Job<T>> {
    await this.promises.get(id);
    return this.jobs.get(id) as Job<T>;
  }
}

export const jobs = new JobManager();
