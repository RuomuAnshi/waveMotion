import React from "react";
import type { AudioAnalysis, RhythmConfig } from "../../shared/types.ts";

interface RhythmPanelProps {
  analysis: AudioAnalysis;
  rhythm: RhythmConfig;
  onChange: (rhythm: RhythmConfig) => void;
  onRestoreAuto: () => void;
}

export const RhythmPanel: React.FC<RhythmPanelProps> = ({ analysis, rhythm, onChange, onRestoreAuto }) => {
  const auto = rhythm.mode === "auto";
  const confidence = analysis.rhythm.confidence;
  const stability = analysis.rhythm.stability;

  return (
    <div className="section">
      <h3 className="section-title">节奏校正</h3>

      <div className={`rhythm-status${analysis.rhythm.needsCorrection ? " warn" : ""}`}>
        <div className="rhythm-status-row">
          <span>自动 BPM</span>
          <span className="mono">{analysis.bpm.toFixed(2)}</span>
        </div>
        <div className="rhythm-status-row">
          <span>节奏稳定性</span>
          <span className="mono">{(stability * 100).toFixed(0)}%</span>
        </div>
        <div className="rhythm-status-row">
          <span>检测置信度</span>
          <span className="mono">{(confidence * 100).toFixed(0)}%</span>
        </div>
        {analysis.rhythm.needsCorrection && <p className="rhythm-hint">{analysis.rhythm.hint}</p>}
      </div>

      <div className="segmented">
        <button className={auto ? "active" : ""} onClick={onRestoreAuto}>
          自动分析
        </button>
        <button
          className={!auto ? "active" : ""}
          onClick={() =>
            onChange({
              ...rhythm,
              mode: "manual",
              bpm: rhythm.bpm ?? Math.round(analysis.bpm * 100) / 100,
            })
          }
        >
          手动
        </button>
      </div>

      <label className="field">
        <div className="field-head">
          <span>BPM</span>
          <span className="field-value mono">
            {auto ? analysis.bpm.toFixed(2) : (rhythm.bpm ?? analysis.bpm).toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={40}
          max={240}
          step={0.1}
          value={auto ? analysis.bpm : (rhythm.bpm ?? analysis.bpm)}
          disabled={auto}
          onChange={(e) => onChange({ ...rhythm, mode: "manual", bpm: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <div className="field-head">
          <span>起拍偏移</span>
          <span className="field-value mono">{rhythm.offsetSec.toFixed(3)}s</span>
        </div>
        <input
          type="range"
          min={-0.5}
          max={0.5}
          step={0.005}
          value={rhythm.offsetSec}
          onChange={(e) => onChange({ ...rhythm, offsetSec: Number(e.target.value) })}
        />
      </label>

      <div className="field">
        <div className="field-head">
          <span>视觉节奏</span>
        </div>
        <div className="segmented">
          {([0.5, 1, 2] as const).map((rate) => (
            <button
              key={rate}
              className={rhythm.rate === rate ? "active" : ""}
              onClick={() => onChange({ ...rhythm, rate })}
            >
              {rate === 0.5 ? "半速" : rate === 1 ? "正常" : "双速"}
            </button>
          ))}
        </div>
      </div>

      <button className="btn btn-ghost btn-block" onClick={onRestoreAuto}>
        恢复自动分析
      </button>
    </div>
  );
};
