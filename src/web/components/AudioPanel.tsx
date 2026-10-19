import React, { useRef } from "react";
import type { AudioEntry } from "../../shared/types.ts";

import { Icon } from "./Icon.tsx";

interface AudioPanelProps {
  audioList: AudioEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onImport: (file: File) => void;
  onRefresh: () => void;
  importing: boolean;
  analyzing: boolean;
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(n: number | undefined): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const AudioPanel: React.FC<AudioPanelProps> = ({
  audioList,
  selectedId,
  onSelect,
  onImport,
  onRefresh,
  importing,
  analyzing,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="panel-section">
      <div className="panel-head">
        <h2>音频素材</h2>
        <div className="panel-head-actions">
          <button className="btn btn-tiny" onClick={onRefresh} title="重新扫描 assets 与导入目录">
            刷新
          </button>
          <button className="btn btn-tiny btn-primary" onClick={() => fileRef.current?.click()} disabled={importing}>
            <Icon name="plus" size={12} />{importing ? "导入中…" : "导入"}
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = "";
        }}
      />
      <ul className="audio-list">
        {audioList.length === 0 && <li className="empty-note">assets 目录内没有可用音频</li>}
        {audioList.map((item) => (
          <li key={item.id}>
            <button
              className={`audio-item${selectedId === item.id ? " active" : ""}`}
              aria-pressed={selectedId === item.id}
              onClick={() => onSelect(item.id)}
            >
              <span className={`audio-item-icon${selectedId === item.id && analyzing ? " is-analyzing" : ""}`}><Icon name="music" size={16} /></span>
              <span className="audio-item-main">
                <span className="audio-item-name" title={item.name}>
                  {item.name}
                </span>
                <span className="audio-item-meta">
                  {formatDuration(item.durationSec)}
                  {item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                  {item.source === "import" ? " · 已导入" : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
