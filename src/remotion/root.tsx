import React from "react";
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame, useVideoConfig } from "remotion";
import type { WaveMotionProps } from "../shared/renderPayload.ts";
import type { VisualConfig } from "../shared/types.ts";
import { SceneEngine, type Scene } from "../engine/frame.ts";
import { TemplateRenderer } from "../templates/index.tsx";
import { DEFAULT_VISUAL } from "../shared/constants.ts";
import { EMPTY_ANALYSIS } from "./emptyAnalysis.ts";

/** 引擎缓存在渲染进程内复用；visual 变化时自动重建 timeline */
const engineCache = new WeakMap<VisualConfig, SceneEngine>();

function getEngine(visual: VisualConfig): SceneEngine {
  let e = engineCache.get(visual);
  if (!e) {
    e = new SceneEngine(visual);
    engineCache.set(visual, e);
  }
  return e;
}

export const WaveMotionBackground: React.FC<WaveMotionProps> = ({ analysis, visual }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const engine = getEngine(visual);
  const scene: Scene = engine.scene(analysis, frame, fps, width, height);

  return (
    <AbsoluteFill style={{ backgroundColor: scene.palette.background }}>
      <TemplateRenderer scene={scene} />
    </AbsoluteFill>
  );
};

export const DEFAULT_PROPS: WaveMotionProps = {
  analysis: EMPTY_ANALYSIS,
  visual: DEFAULT_VISUAL,
  output: { width: 1920, height: 1080, fps: 30, totalFrames: 300 },
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="WaveMotion"
    component={WaveMotionBackground}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={300}
    defaultProps={DEFAULT_PROPS}
    calculateMetadata={({ props }) => {
      const out = props.output ?? DEFAULT_PROPS.output;
      return {
        fps: out.fps,
        width: out.width,
        height: out.height,
        durationInFrames: Math.max(1, out.totalFrames),
      };
    }}
  />
);

registerRoot(RemotionRoot);
