import React from "react";
import type { Scene } from "../engine/frame.ts";
import type { TemplateId } from "../shared/types.ts";
import { GradientPulse } from "./GradientPulse.tsx";
import { NeonHalo } from "./NeonHalo.tsx";
import { MirrorSpectrum } from "./MirrorSpectrum.tsx";
import { ParticleField } from "./ParticleField.tsx";
import { GeoTunnel } from "./GeoTunnel.tsx";
import { FlowField } from "./FlowField.tsx";

export const TEMPLATE_COMPONENTS: Record<TemplateId, React.FC<{ scene: Scene }>> = {
  gradientPulse: GradientPulse,
  neonHalo: NeonHalo,
  mirrorSpectrum: MirrorSpectrum,
  particleField: ParticleField,
  geoTunnel: GeoTunnel,
  flowField: FlowField,
};

export function TemplateRenderer({ scene }: { scene: Scene }) {
  const Comp = TEMPLATE_COMPONENTS[scene.visual.template] ?? GradientPulse;
  return <Comp scene={scene} />;
}
