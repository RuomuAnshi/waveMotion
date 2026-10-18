import type {
  AudioAnalysis,
  AudioEntry,
  OutputConfig,
  ProjectConfig,
  RenderJob,
  VisualConfig,
} from "../shared/types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const message = (data as { error?: string })?.error ?? `请求失败（${res.status}）`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),

  listAudio: () => request<{ audio: AudioEntry[] }>("/api/audio"),
  refreshAudio: () => request<{ audio: AudioEntry[] }>("/api/audio/refresh", { method: "POST" }),
  importAudio: (file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return request<{ audio: AudioEntry }>("/api/audio/import", { method: "POST", body: form });
  },

  analyze: (audioId: string, force = false) =>
    request<{ analysis: AudioAnalysis; cached: boolean }>("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ audioId, force }),
    }),
  cachedAnalysis: (audioId: string) =>
    request<{ analysis: AudioAnalysis; cached: boolean; audio: AudioEntry | null }>(
      `/api/analyze/cache/${encodeURIComponent(audioId)}`,
    ),

  createRender: (payload: { audioId: string; visual: VisualConfig; output: OutputConfig }) =>
    request<{ job: RenderJob }>("/api/render", { method: "POST", body: JSON.stringify(payload) }),
  listRenders: () => request<{ jobs: RenderJob[] }>("/api/render"),
  getRender: (id: string) => request<{ job: RenderJob }>(`/api/render/${encodeURIComponent(id)}`),
  cancelRender: (id: string) =>
    request<{ job: RenderJob }>(`/api/render/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  retryRender: (id: string) =>
    request<{ job: RenderJob }>(`/api/render/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  clearFinished: () => request<{ removed: number }>("/api/render/clear-finished", { method: "POST" }),

  listProjects: () => request<{ projects: ProjectConfig[] }>("/api/projects"),
  saveProject: (project: ProjectConfig) =>
    request<{ project: ProjectConfig }>("/api/projects", { method: "POST", body: JSON.stringify(project) }),
  getProject: (id: string) => request<{ project: ProjectConfig }>(`/api/projects/${encodeURIComponent(id)}`),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  importProject: (project: ProjectConfig) =>
    request<{ project: ProjectConfig }>("/api/projects/import", { method: "POST", body: JSON.stringify(project) }),
};

export interface HealthResponse {
  ok: boolean;
  version: string;
  python: { ok: boolean; bin: string; message: string };
  browser: { path: string | null; ok: boolean };
  ffmpeg: { path: string; ffprobe: string };
  queue: { total: number; running: number; queued: number };
}
