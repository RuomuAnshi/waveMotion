import React, { useState } from "react";
import type { OutputConfig, RenderJob } from "../../shared/types.ts";
import { resolveOutputSpec } from "../../shared/types.ts";

import { Icon } from "./Icon.tsx";

interface ExportPanelProps {
  output: OutputConfig;
  onOutputChange: (output: OutputConfig) => void;
  durationSec: number;
  jobs: RenderJob[];
  onExport: () => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onClearFinished: () => void;
  exporting: boolean;
}

const ASPECT_LABELS: Array<{ id: OutputConfig["aspect"]; label: string; note: string }> = [
  { id: "16:9", label: "横屏", note: "16:9" },
  { id: "9:16", label: "竖屏", note: "9:16" },
  { id: "1:1", label: "方形", note: "1:1" },
];

function formatBytes(n: number | undefined): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_TEXT: Record<RenderJob["status"], string> = {
  queued: "排队中",
  running: "渲染中",
  done: "已完成",
  error: "失败",
  cancelled: "已取消",
};

export const ExportPanel: React.FC<ExportPanelProps> = ({
  output,
  onOutputChange,
  durationSec,
  jobs,
  onExport,
  onCancel,
  onRetry,
  onClearFinished,
}) => {
  const spec = resolveOutputSpec(output);
  const totalFrames = Math.max(1, Math.ceil(durationSec * spec.fps - 1e-6));
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? jobs : jobs.slice(0, 3);

  return (
    <div className="section">
      <h3 className="section-title">导出</h3>

      <div className="field">
        <div className="field-head">
          <span>画面比例</span>
        </div>
        <div className="segmented">
          {ASPECT_LABELS.map((a) => (
            <button
              key={a.id}
              className={output.aspect === a.id ? "active" : ""}
              onClick={() => onOutputChange({ ...output, aspect: a.id })}
            >
              {a.label}
              <small>{a.note}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="field-head">
          <span>分辨率</span>
        </div>
        <div className="segmented">
          <button className={output.resolution === "1080" ? "active" : ""} onClick={() => onOutputChange({ ...output, resolution: "1080" })}>
            1080 级
          </button>
          <button className={output.resolution === "1440" ? "active" : ""} onClick={() => onOutputChange({ ...output, resolution: "1440" })}>
            1440 级
          </button>
        </div>
      </div>

      <div className="field">
        <div className="field-head">
          <span>帧率</span>
        </div>
        <div className="segmented">
          <button className={output.fps === 30 ? "active" : ""} onClick={() => onOutputChange({ ...output, fps: 30 })}>
            30 fps
          </button>
          <button className={output.fps === 60 ? "active" : ""} onClick={() => onOutputChange({ ...output, fps: 60 })}>
            60 fps
          </button>
        </div>
      </div>

      <label className="field field-inline">
        <span>保留原音频</span>
        <input
          type="checkbox"
          checked={output.includeAudio}
          onChange={(e) => onOutputChange({ ...output, includeAudio: e.target.checked })}
        />
      </label>

      <div className="output-summary mono">
        {spec.width}×{spec.height} · {spec.fps}fps · {totalFrames} 帧 · {durationSec.toFixed(2)}s
      </div>

      <button className="btn btn-primary btn-block btn-lg" onClick={onExport}>
        <Icon name="download" />导出 MP4
      </button>

      <div className="job-list">
        <div className="job-list-head">
          <span>导出任务</span>
          {jobs.some((j) => j.status === "done" || j.status === "error" || j.status === "cancelled") && (
            <button className="btn btn-tiny btn-ghost" onClick={onClearFinished}>
              清除已结束
            </button>
          )}
        </div>
        {visible.length === 0 && <p className="empty-note">还没有导出任务</p>}
        {visible.map((job) => (
          <div key={job.id} className={`job-row job-${job.status}`}>
            <div className="job-row-main">
              <span className={`job-status job-status-${job.status}`}>{STATUS_TEXT[job.status]}</span>
              <span className="job-meta mono">
                {job.snapshot.width}×{job.snapshot.height} · {job.snapshot.output.fps}fps
              </span>
            </div>
            {job.status === "running" && (
              <div className="job-progress">
                <div className="job-progress-bar" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                <span className="job-progress-text mono">{Math.round(job.progress * 100)}%</span>
              </div>
            )}
            {job.status === "error" && job.error && <p className="job-error">{job.error}</p>}
            <div className="job-row-actions">
              {job.status === "done" && job.output && (
                <a className="btn btn-tiny btn-primary" href={job.output.url} download={job.output.fileName}>
                  下载 {formatBytes(job.output.sizeBytes)}
                </a>
              )}
              {(job.status === "running" || job.status === "queued") && (
                <button className="btn btn-tiny btn-ghost" onClick={() => onCancel(job.id)}>
                  取消
                </button>
              )}
              {(job.status === "error" || job.status === "cancelled") && (
                <button className="btn btn-tiny" onClick={() => onRetry(job.id)}>
                  重试
                </button>
              )}
            </div>
          </div>
        ))}
        {jobs.length > 3 && (
          <button className="btn btn-tiny btn-ghost btn-block" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "收起" : `查看全部 ${jobs.length} 个任务`}
          </button>
        )}
      </div>
    </div>
  );
};
