import React, { useRef } from "react";
import type { ProjectConfig } from "../../shared/types.ts";

interface ProjectPanelProps {
  projects: ProjectConfig[];
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (file: File) => void;
  onExportJson: (id: string) => void;
}

export const ProjectPanel: React.FC<ProjectPanelProps> = ({
  projects,
  onSave,
  onLoad,
  onDelete,
  onImport,
  onExportJson,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = React.useState("");

  return (
    <div className="section">
      <h3 className="section-title">项目配置</h3>
      <div className="project-save-row">
        <input
          className="text-input"
          placeholder="配置名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="btn btn-tiny btn-primary"
          onClick={() => {
            onSave(name.trim() || `项目 ${new Date().toLocaleString("zh-CN", { hour12: false })}`);
            setName("");
          }}
        >
          保存
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = "";
        }}
      />
      <button className="btn btn-ghost btn-block btn-tiny" onClick={() => fileRef.current?.click()}>
        导入项目 JSON
      </button>
      <ul className="project-list">
        {projects.length === 0 && <li className="empty-note">还没有保存的配置</li>}
        {projects.map((p) => (
          <li key={p.id} className="project-item">
            <div className="project-item-main">
              <span className="project-item-name">{p.name}</span>
              <span className="project-item-meta">
                {p.visual.template} · {p.output.aspect} · {p.output.fps}fps
              </span>
            </div>
            <div className="project-item-actions">
              <button className="btn btn-tiny" onClick={() => p.id && onLoad(p.id)}>
                载入
              </button>
              <button className="btn btn-tiny btn-ghost" onClick={() => p.id && onExportJson(p.id)} title="导出 JSON">
                ⇩
              </button>
              <button className="btn btn-tiny btn-danger" onClick={() => p.id && onDelete(p.id)} title="删除">
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
