import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AspectRatioId, Fps, RenderJob, ResolutionTier, VisualConfig, OutputConfig } from "../../src/shared/types.ts";
import { resolveOutputSpec } from "../../src/shared/types.ts";
import { RENDERS_DIR, TMP_DIR, ensureDir, writeJsonAtomic, readJson } from "./paths.ts";
import { verifyRender } from "./ffmpeg.ts";
import type { AudioAnalysis } from "../../src/shared/types.ts";

export interface RenderTaskInput {
  audioId: string;
  audioPath: string;
  audioName: string;
  analysis: AudioAnalysis;
  visual: VisualConfig;
  output: OutputConfig;
  durationSec: number;
}

export interface RenderCallbacks {
  render: (job: RenderJob, ctx: RenderContext) => Promise<void>;
  onUpdate: (job: RenderJob) => void;
}

export interface RenderContext {
  /** 0..1 */
  report: (progress: number) => void;
  /** 注册取消回调（返回 true 表示可中断） */
  onCancel: (fn: () => void) => void;
  isCancelled: () => boolean;
}

/** 一次只跑一个任务，其余排队 */
class RenderQueue {
  private jobs = new Map<string, RenderJob>();
  private order: string[] = [];
  private running: string | null = null;
  private callbacks: RenderCallbacks | null = null;
  private cancelHooks = new Map<string, () => void>();
  private cancelled = new Set<string>();
  private persistPath = path.join(RENDERS_DIR, "jobs.json");

  configure(callbacks: RenderCallbacks): void {
    this.callbacks = callbacks;
    this.loadPersisted();
  }

  private loadPersisted(): void {
    const saved = readJson<RenderJob[]>(this.persistPath);
    if (!Array.isArray(saved)) return;
    for (const job of saved) {
      // 重启后：没有结果文件的任务标记为失败；已完成但文件还在的保留
      if (job.status === "running" || job.status === "queued") {
        this.jobs.set(job.id, { ...job, status: "error", error: "服务重启，任务已中断，请重试" });
      } else if (job.output && fs.existsSync(job.output.path)) {
        this.jobs.set(job.id, job);
      }
    }
    this.order = [...this.jobs.keys()];
    this.persist();
  }

  private persist(): void {
    ensureDir(RENDERS_DIR);
    writeJsonAtomic(this.persistPath, this.list());
  }

  private persistDebounced = (() => {
    let timer: NodeJS.Timeout | null = null;
    return () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        this.persist();
      }, 400);
    };
  })();

  create(input: RenderTaskInput): RenderJob {
    const id = crypto.randomUUID();
    const spec = resolveOutputSpec(input.output);
    const totalFrames = Math.max(1, Math.ceil(input.durationSec * spec.fps - 1e-6));
    const job: RenderJob = {
      id,
      status: "queued",
      progress: 0,
      createdAt: new Date().toISOString(),
      snapshot: {
        audioId: input.audioId,
        audioPath: input.audioPath,
        visual: structuredClone(input.visual),
        output: structuredClone(input.output),
        durationSec: input.durationSec,
        totalFrames,
        width: spec.width,
        height: spec.height,
        includeAudio: spec.includeAudio,
      },
      attempt: 1,
    };
    this.jobs.set(id, job);
    this.order.push(id);
    this.persist();
    this.pump();
    return job;
  }

  /** 重试失败的导出：同参数快照新建任务，attempt+1 */
  retry(id: string): RenderJob | null {
    const old = this.jobs.get(id);
    if (!old || (old.status !== "error" && old.status !== "cancelled")) return null;
    const newId = crypto.randomUUID();
    const job: RenderJob = {
      ...structuredClone(old),
      id: newId,
      status: "queued",
      progress: 0,
      createdAt: new Date().toISOString(),
      startedAt: undefined,
      finishedAt: undefined,
      output: undefined,
      error: undefined,
      attempt: old.attempt + 1,
    };
    this.jobs.set(newId, job);
    this.order.push(newId);
    this.persist();
    this.pump();
    return job;
  }

  get(id: string): RenderJob | null {
    return this.jobs.get(id) ?? null;
  }

  list(): RenderJob[] {
    return this.order
      .map((id) => this.jobs.get(id))
      .filter(Boolean)
      .map((j) => j as RenderJob)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === "queued") {
      job.status = "cancelled";
      job.finishedAt = new Date().toISOString();
      this.cancelled.add(id);
      this.persist();
      this.callbacks?.onUpdate(job);
      return true;
    }
    if (job.status === "running") {
      this.cancelled.add(id);
      const hook = this.cancelHooks.get(id);
      try {
        hook?.();
      } catch {
        // ignore
      }
      return true;
    }
    return false;
  }

  private nextQueued(): RenderJob | null {
    for (const id of this.order) {
      const job = this.jobs.get(id);
      if (job && job.status === "queued" && !this.cancelled.has(id)) return job;
    }
    return null;
  }

  private pump(): void {
    if (this.running || !this.callbacks) return;
    const job = this.nextQueued();
    if (!job) return;
    this.running = job.id;
    void this.run(job);
  }

  private async run(job: RenderJob): Promise<void> {
    const callbacks = this.callbacks as RenderCallbacks;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.progress = 0;
    this.persist();
    callbacks.onUpdate(job);

    const ctx: RenderContext = {
      report: (progress) => {
        if (this.cancelled.has(job.id)) return;
        job.progress = Math.max(job.progress, Math.min(0.999, progress));
        callbacks.onUpdate(job);
        this.persistDebounced();
      },
      onCancel: (fn) => {
        this.cancelHooks.set(job.id, fn);
      },
      isCancelled: () => this.cancelled.has(job.id),
    };

    try {
      await callbacks.render(job, ctx);
      if (this.cancelled.has(job.id)) {
        job.status = "cancelled";
        job.finishedAt = new Date().toISOString();
        job.error = undefined;
      } else {
        job.status = "done";
        job.progress = 1;
        job.finishedAt = new Date().toISOString();
      }
    } catch (err) {
      if (this.cancelled.has(job.id)) {
        job.status = "cancelled";
        job.finishedAt = new Date().toISOString();
      } else {
        job.status = "error";
        job.error = err instanceof Error ? err.message : String(err);
        job.finishedAt = new Date().toISOString();
      }
    } finally {
      this.cancelHooks.delete(job.id);
      this.running = null;
      this.persist();
      callbacks.onUpdate(job);
      // 继续下一个排队任务
      setTimeout(() => this.pump(), 50);
    }
  }

  /** 清除历史任务记录（保留已完成的成片文件） */
  clearFinished(): number {
    let removed = 0;
    for (const id of [...this.order]) {
      const job = this.jobs.get(id);
      if (job && job.status !== "running" && job.status !== "queued") {
        this.jobs.delete(id);
        this.order = this.order.filter((x) => x !== id);
        removed++;
      }
    }
    this.persist();
    return removed;
  }
}

export const renderQueue = new RenderQueue();
export { RENDERS_DIR, TMP_DIR, ensureDir, verifyRender };
