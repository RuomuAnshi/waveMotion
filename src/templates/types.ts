import type { Scene } from "../engine/frame.ts";

/** 所有模板共享的渲染接口 */
export interface TemplateProps {
  scene: Scene;
}

export type TemplateComponent = React.FC<TemplateProps>;
