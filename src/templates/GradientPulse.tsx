import React from "react";
import type { Scene } from "../engine/frame.ts";
import { clamp, lerp, mixColor, smoothstep } from "../engine/random.ts";

/**
 * Reference: assets/背景.mp4. A coloured disc on black expands to fill the
 * viewport. In the active phrase, individual beats launch a polygon outline
 * which expands, thins and disappears. Quiet phrases return to the solid disc.
 * There is no permanent white ring, bloom, extra inner ring or particle layer.
 */
export function gradientPulseState(scene: Scene) {
  const { time, unit, beat, timeline, visual } = scene;
  const interval = Math.max(0.15, timeline.intervalSec);
  const introEnd = timeline.times[4] ?? interval * 4;
  const intro = Math.pow(clamp(time / Math.max(0.3, introEnd * 0.86)), 2.7);
  const phraseBeat = beat.index - 4;
  const phrasePosition = ((phraseBeat % 8) + 8) % 8;
  const activePhrase = phraseBeat >= 0 && (visual.autoVariation ? phrasePosition < 4 : true);
  const gate = smoothstep(0.015, 0.12, scene.rms);
  const response = clamp(visual.intensity * 2, 0, 2);
  const ringLife = Math.min(0.32, interval * 0.7);
  const ringProgress = clamp(beat.sinceSec / ringLife);
  const ringOpacity = activePhrase
    ? Math.pow(1 - ringProgress, 1.4) * gate * Math.min(1, response)
    : 0;
  const ringRadius = unit * (0.34 + ringProgress * (0.78 + response * 0.22));
  const ringWidth = unit * (0.003 + 0.07 * Math.pow(1 - ringProgress, 1.5));

  // Four beats of expanding outlines, then a colour wash which contracts into
  // a red disc. A beat's continuous position avoids the old modulo size jump.
  const nextBeat = timeline.times[beat.index + 1];
  const thisInterval = beat.index >= 0 && nextBeat !== undefined
    ? Math.max(0.05, nextBeat - timeline.times[beat.index]!)
    : interval;
  const sinceFraction = clamp(beat.sinceSec / thisInterval);
  const contraction = visual.autoVariation && phraseBeat >= 0
    ? smoothstep(5, 7.2, phrasePosition + sinceFraction)
    : 0;
  const discRadius = unit * lerp(lerp(0.56, 1.18, intro), 0.66, contraction);
  const colourFlash = activePhrase ? Math.exp(-Math.max(0, beat.sinceSec) / 0.11) * gate : 0;
  const restColour = phraseBeat >= 0 && !activePhrase ? smoothstep(3.8, 5, phrasePosition + sinceFraction) : 0;

  // The default preset is calibrated to the source; other presets and custom
  // colours use the selected palette rather than silently staying purple/red.
  const referencePalette = visual.palette === "crimsonPurple";
  const primary = referencePalette ? "#700a83" : scene.colors.primary;
  const secondary = referencePalette ? "#a9211f" : scene.colors.secondary;
  const colourMix = visual.autoVariation ? Math.max(colourFlash * 0.66, restColour) : 0;
  const center = mixColor(primary, secondary, colourMix);
  const edge = mixColor(center, "#000000", 0.76);
  const backdrop = visual.palette === "custom" ? scene.colors.background : "#000000";
  const brightness = 0.5 + visual.backgroundBrightness;
  const fadeOut = smoothstep(0, 0.16, scene.analysis.analysis.durationSec - time);

  return { discRadius, ringRadius, ringWidth, ringOpacity, center, edge, backdrop, brightness, fadeOut };
}

/** A nearly circular, stable polygon; wobble is continuous rather than stepped. */
function outlinePath(cx: number, cy: number, radius: number, sides: number, wobble: number, time: number, seed: number): string {
  const points = Array.from({ length: sides }, (_, i) => {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / sides;
    const r = radius * (1 + Math.sin(i * 2.17 + time * 0.6 + seed * 0.001) * wobble * 0.006);
    return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
  });
  return `M${points.join("L")}Z`;
}

export const GradientPulse: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { width, height, unit, param, time, seed } = scene;
  const state = gradientPulseState(scene);
  const cx = width / 2;
  const cy = height / 2;
  const sides = Math.round(clamp(param.num("polygonSides", 22), 3, 24));
  const ringCount = Math.round(clamp(param.num("ringCount", 1), 1, 5));
  const softness = clamp(param.num("blobAmount", 0.6));
  const wobble = clamp(param.num("wobble", 0.42));
  // useId prevents SVG definition collisions if multiple previews share a page.
  const id = React.useId().replace(/:/g, "");
  const gradientId = `disc-gradient-${id}`;
  const clipId = `disc-clip-${id}`;
  const path = outlinePath(cx, cy, state.discRadius, sides, wobble, time, seed);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: state.backdrop }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0, opacity: state.fadeOut }}>
        <defs>
          <radialGradient id={gradientId} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={state.discRadius}>
            <stop offset="0%" stopColor={state.center} />
            <stop offset={`${25 + softness * 23}%`} stopColor={mixColor(state.center, state.edge, 0.2)} />
            <stop offset="100%" stopColor={state.edge} />
          </radialGradient>
          <clipPath id={clipId}><path d={path} /></clipPath>
        </defs>
        <g style={{ filter: `brightness(${state.brightness})` }}>
          <rect width={width} height={height} fill={`url(#${gradientId})`} clipPath={`url(#${clipId})`} />
          {state.ringOpacity > 0.001 && Array.from({ length: ringCount }, (_, i) => (
            <path
              key={i}
              d={outlinePath(cx, cy, state.ringRadius * (1 + i * 0.1), sides, wobble, time, seed)}
              fill="none"
              stroke={scene.colors.accent}
              strokeOpacity={state.ringOpacity * Math.pow(0.4, i)}
              strokeWidth={state.ringWidth / (i + 1)}
              strokeLinejoin="round"
            />
          ))}
        </g>
      </svg>
    </div>
  );
};
