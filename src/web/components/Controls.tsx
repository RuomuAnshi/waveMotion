import React from "react";
import type { ColorSet, PaletteId, TemplateId, TemplateParamSpec } from "../../shared/types.ts";
import { PALETTES, TEMPLATE_META, TEMPLATE_PARAMS } from "../../shared/constants.ts";

import { Icon } from "./Icon.tsx";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: string;
  format?: (v: number) => string;
}

export const Slider: React.FC<SliderProps> = ({ label, value, min, max, step = 0.01, onChange, hint, format }) => (
  <label className="field" title={hint}>
    <div className="field-head">
      <span>{label}</span>
      <span className="field-value mono">{format ? format(value) : value.toFixed(2)}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
  </label>
);

interface PalettePickerProps {
  palette: PaletteId;
  customColors: ColorSet;
  onChange: (palette: PaletteId) => void;
  onCustomColors: (colors: ColorSet) => void;
}

export const PalettePicker: React.FC<PalettePickerProps> = ({ palette, customColors, onChange, onCustomColors }) => (
  <div className="field">
    <div className="field-head">
      <span>配色预设</span>
    </div>
    <div className="palette-grid">
      {(Object.keys(PALETTES) as Array<Exclude<PaletteId, "custom">>).map((id) => {
        const p = PALETTES[id];
        return (
          <button
            key={id}
            className={`palette-swatch${palette === id ? " active" : ""}`}
            onClick={() => onChange(id)}
            title={p.name}
            aria-pressed={palette === id}
          >
            <span className="palette-bar">
              {[p.colors.primary, p.colors.secondary, p.colors.accent].map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            <span className="palette-name">{p.name}</span>
          </button>
        );
      })}
      <button
        className={`palette-swatch${palette === "custom" ? " active" : ""}`}
        onClick={() => onChange("custom")}
        title="自定义颜色"
        aria-pressed={palette === "custom"}
      >
        <span className="palette-bar">
          {[customColors.primary, customColors.secondary, customColors.accent].map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </span>
        <span className="palette-name">自定义</span>
      </button>
    </div>
    {palette === "custom" && (
      <div className="color-inputs">
        {(
          [
            ["background", "背景"],
            ["primary", "主色"],
            ["secondary", "辅色"],
            ["accent", "描边"],
          ] as Array<[keyof ColorSet, string]>
        ).map(([key, label]) => (
          <label key={key} className="color-input">
            <input
              type="color"
              value={customColors[key]}
              onChange={(e) => onCustomColors({ ...customColors, [key]: e.target.value })}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    )}
  </div>
);

interface TemplateParamControlsProps {
  template: TemplateId;
  params: Record<string, number | boolean>;
  onChange: (key: string, value: number | boolean) => void;
}

export const TemplateParamControls: React.FC<TemplateParamControlsProps> = ({ template, params, onChange }) => {
  const specs = TEMPLATE_PARAMS[template];
  return (
    <div className="section">
      <h3 className="section-title">模板参数</h3>
      {specs.map((spec: TemplateParamSpec) =>
        spec.type === "boolean" ? (
          <label key={spec.key} className="field field-inline" title={spec.hint}>
            <span>{spec.label}</span>
            <input
              type="checkbox"
              checked={Boolean(params[spec.key] ?? spec.default)}
              onChange={(e) => onChange(spec.key, e.target.checked)}
            />
          </label>
        ) : (
          <Slider
            key={spec.key}
            label={spec.label}
            value={Number(params[spec.key] ?? spec.default)}
            min={spec.min ?? 0}
            max={spec.max ?? 1}
            step={spec.step ?? 0.01}
            hint={spec.hint}
            format={(v) => (Number.isInteger(spec.step ?? 0) ? String(Math.round(v)) : v.toFixed(2))}
            onChange={(v) => onChange(spec.key, v)}
          />
        ),
      )}
    </div>
  );
};

interface TemplatePickerProps {
  value: TemplateId;
  onChange: (id: TemplateId) => void;
}

export const TemplatePicker: React.FC<TemplatePickerProps> = ({ value, onChange }) => (
  <div className="template-grid">
    {TEMPLATE_META.map((meta) => (
      <button
        key={meta.id}
        className={`template-card${value === meta.id ? " active" : ""}`}
        aria-pressed={value === meta.id}
        onClick={() => onChange(meta.id)}
      >
        <span className={`template-art template-art-${meta.id}`} aria-hidden="true"><i /><i /><i /><i /><i /></span>
        <span className="template-card-copy"><span className="template-card-name">{meta.name}</span><span className="template-card-desc">{meta.description}</span></span>
        {value === meta.id && <span className="template-check"><Icon name="check" size={12} /></span>}
      </button>
    ))}
  </div>
);
