import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import type {
  AudioAnalysis,
  AudioEntry,
  OutputConfig,
  PaletteId,
  ProjectConfig,
  RenderJob,
  RhythmConfig,
  TemplateId,
  VisualConfig,
} from "../shared/types.ts";
import { resolveOutputSpec } from "../shared/types.ts";
import { DEFAULT_OUTPUT, DEFAULT_VISUAL, defaultTemplateParams } from "../shared/constants.ts";
import { api } from "./api.ts";
import { AudioPanel } from "./components/AudioPanel.tsx";
import { PreviewStage } from "./components/PreviewStage.tsx";
import { TimelineScrubber } from "./components/TimelineScrubber.tsx";
import { Transport } from "./components/Transport.tsx";
import { PalettePicker, Slider, TemplateParamControls, TemplatePicker } from "./components/Controls.tsx";
import { RhythmPanel } from "./components/RhythmPanel.tsx";
import { ExportPanel } from "./components/ExportPanel.tsx";
import { ProjectPanel } from "./components/ProjectPanel.tsx";
import { buildBeatTimeline } from "../engine/beat.ts";
import { useBeatHint } from "./hooks/useBeatHint.ts";

type Toast = { id: number; kind: "info" | "error" | "success"; text: string };

const STORAGE_KEY = "wavemotion:last-session";

interface LastSession {
  audioId: string | null;
  visual: VisualConfig;
  output: OutputConfig;
}

function loadLastSession(): LastSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastSession;
    if (!parsed.visual || !parsed.output) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const App: React.FC = () => {
  const restored = useRef<LastSession | null>(loadLastSession());

  const [audioList, setAudioList] = useState<AudioEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(restored.current?.audioId ?? null);
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [visual, setVisual] = useState<VisualConfig>(restored.current?.visual ?? DEFAULT_VISUAL);
  const [output, setOutput] = useState<OutputConfig>(restored.current?.output ?? DEFAULT_OUTPUT);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [importing, setImporting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [loopRange, setLoopRange] = useState<{ start: number; end: number } | null>(null);
  const [beatHint, setBeatHint] = useState(false);
  const [seekRequest, setSeekRequest] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  const playerRef = useRef<PlayerRef | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, text }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const selectedAudio = useMemo(() => audioList.find((a) => a.id === selectedId) ?? null, [audioList, selectedId]);
  const durationSec = analysis?.durationSec ?? selectedAudio?.durationSec ?? 0;
  const spec = resolveOutputSpec(output);
  const totalFrames = Math.max(1, Math.ceil(durationSec * spec.fps - 1e-6));

  const beatTimeline = useMemo(
    () => (analysis ? buildBeatTimeline(analysis, visual.rhythm) : null),
    [analysis, visual.rhythm],
  );

  // ---- 初始加载 ----
  useEffect(() => {
    void (async () => {
      try {
        const [{ audio }, { projects: projectList }] = await Promise.all([api.listAudio(), api.listProjects()]);
        setAudioList(audio);
        setProjects(projectList);
        if (!selectedId && audio.length > 0) setSelectedId(audio[0].id);
      } catch (err) {
        toast("error", `无法连接本地服务：${(err as Error).message}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 选择音频后自动分析（优先用缓存） ----
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void (async () => {
      setAnalyzing(true);
      setAnalysisError(null);
      try {
        const cached = await api.cachedAnalysis(selectedId).catch(() => null);
        if (cancelled) return;
        if (cached?.analysis) {
          setAnalysis(cached.analysis);
          setAnalyzing(false);
          return;
        }
        const result = await api.analyze(selectedId);
        if (cancelled) return;
        setAnalysis(result.analysis);
      } catch (err) {
        if (cancelled) return;
        setAnalysisError((err as Error).message);
        toast("error", `音频分析失败：${(err as Error).message}`);
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, toast]);

  // ---- 保存最近的会话（音频 / 模板 / 输出规格） ----
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ audioId: selectedId, visual, output }));
    } catch {
      /* 忽略 */
    }
  }, [selectedId, visual, output]);

  // ---- 导出任务轮询 ----
  const activeExists = jobs.some((j) => j.status === "running" || j.status === "queued");
  useEffect(() => {
    void (async () => {
      try {
        const { jobs: list } = await api.listRenders();
        setJobs(list);
      } catch {
        /* 忽略 */
      }
    })();
  }, []);
  useEffect(() => {
    if (!activeExists) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const { jobs: list } = await api.listRenders();
          setJobs(list);
        } catch {
          /* 忽略 */
        }
      })();
    }, 1200);
    return () => window.clearInterval(id);
  }, [activeExists]);

  // ---- 音频播放同步 ----
  const syncAudio = useCallback(
    (targetPlaying: boolean) => {
      const el = audioElRef.current;
      if (!el) return;
      if (targetPlaying) void el.play().catch(() => undefined);
      else el.pause();
    },
    [],
  );

  const handleToggle = useCallback(() => {
    playerRef.current?.toggle();
  }, []);

  const handleSeek = useCallback((nextFrame: number) => {
    const clamped = Math.max(0, Math.min(totalFrames - 1, Math.round(nextFrame)));
    setSeekRequest(clamped);
    setFrame(clamped);
    const el = audioElRef.current;
    if (el) el.currentTime = clamped / spec.fps;
  }, [totalFrames, spec.fps]);

  // Player 播放状态 → 音频元素
  useEffect(() => {
    syncAudio(playing);
    // 只在 playing 变化时同步，frame 变化不反复 seek
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // 循环区间
  useEffect(() => {
    if (!loopRange || !playing) return;
    if (frame >= loopRange.end) {
      setSeekRequest(loopRange.start);
      setFrame(loopRange.start);
      const el = audioElRef.current;
      if (el) el.currentTime = loopRange.start / spec.fps;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, loopRange, playing]);

  // 空格键播放/暂停
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        handleToggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleToggle]);

  // ---- 编辑操作 ----
  const updateVisual = useCallback((patch: Partial<VisualConfig>) => {
    setVisual((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleTemplateChange = useCallback(
    (template: TemplateId) => {
      setVisual((prev) => ({
        ...prev,
        template,
        // 不同模板分别保留上次参数：切回来时恢复该模板的默认/上次设置
        templateParams: prev.templateParams ?? defaultTemplateParams(template),
      }));
    },
    [],
  );

  const handleParamChange = useCallback((key: string, value: number | boolean) => {
    setVisual((prev) => ({ ...prev, templateParams: { ...prev.templateParams, [key]: value } }));
  }, []);

  const handleRhythmChange = useCallback((rhythm: RhythmConfig) => {
    setVisual((prev) => ({ ...prev, rhythm }));
  }, []);

  const handleRestoreAuto = useCallback(() => {
    setVisual((prev) => ({
      ...prev,
      rhythm: { ...prev.rhythm, mode: "auto", bpm: null, offsetSec: 0, rate: 1 },
    }));
  }, []);

  const handleImportAudio = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        const { audio } = await api.importAudio(file);
        const { audio: list } = await api.listAudio();
        setAudioList(list);
        setSelectedId(audio.id);
        toast("success", `已导入 ${audio.name}`);
      } catch (err) {
        toast("error", `导入失败：${(err as Error).message}`);
      } finally {
        setImporting(false);
      }
    },
    [toast],
  );

  const handleRefreshAudio = useCallback(async () => {
    try {
      const { audio } = await api.refreshAudio();
      setAudioList(audio);
      toast("info", `已刷新，共 ${audio.length} 个音频`);
    } catch (err) {
      toast("error", `刷新失败：${(err as Error).message}`);
    }
  }, [toast]);

  const handleExport = useCallback(async () => {
    if (!selectedId) {
      toast("error", "请先选择音频");
      return;
    }
    try {
      await api.createRender({ audioId: selectedId, visual, output });
      const { jobs: list } = await api.listRenders();
      setJobs(list);
      toast("success", "导出任务已提交");
    } catch (err) {
      toast("error", `提交失败：${(err as Error).message}`);
    }
  }, [selectedId, visual, output, toast]);

  const handleCancelJob = useCallback(
    async (id: string) => {
      try {
        await api.cancelRender(id);
        const { jobs: list } = await api.listRenders();
        setJobs(list);
      } catch (err) {
        toast("error", `取消失败：${(err as Error).message}`);
      }
    },
    [toast],
  );

  const handleRetryJob = useCallback(
    async (id: string) => {
      try {
        await api.retryRender(id);
        const { jobs: list } = await api.listRenders();
        setJobs(list);
      } catch (err) {
        toast("error", `重试失败：${(err as Error).message}`);
      }
    },
    [toast],
  );

  const handleClearFinished = useCallback(async () => {
    try {
      await api.clearFinished();
      const { jobs: list } = await api.listRenders();
      setJobs(list);
    } catch (err) {
      toast("error", `清理失败：${(err as Error).message}`);
    }
  }, [toast]);

  const handleSaveProject = useCallback(
    async (name: string) => {
      if (!selectedAudio) {
        toast("error", "请先选择音频");
        return;
      }
      try {
        const project: ProjectConfig = {
          name,
          version: 1,
          audio: { audioId: selectedAudio.id, name: selectedAudio.name, durationSec: selectedAudio.durationSec },
          visual,
          output,
        };
        const { project: saved } = await api.saveProject(project);
        const { projects: list } = await api.listProjects();
        setProjects(list);
        toast("success", `已保存配置「${saved.name}」`);
      } catch (err) {
        toast("error", `保存失败：${(err as Error).message}`);
      }
    },
    [selectedAudio, visual, output, toast],
  );

  const handleLoadProject = useCallback(
    async (id: string) => {
      try {
        const { project } = await api.getProject(id);
        setVisual(project.visual);
        setOutput(project.output);
        if (project.audio.audioId) setSelectedId(project.audio.audioId);
        toast("success", `已载入「${project.name}」`);
      } catch (err) {
        toast("error", `载入失败：${(err as Error).message}`);
      }
    },
    [toast],
  );

  const handleDeleteProject = useCallback(
    async (id: string) => {
      try {
        await api.deleteProject(id);
        const { projects: list } = await api.listProjects();
        setProjects(list);
      } catch (err) {
        toast("error", `删除失败：${(err as Error).message}`);
      }
    },
    [toast],
  );

  const handleImportProject = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as ProjectConfig;
        const { project } = await api.importProject(parsed);
        const { projects: list } = await api.listProjects();
        setProjects(list);
        setVisual(project.visual);
        setOutput(project.output);
        toast("success", `已导入「${project.name}」`);
      } catch (err) {
        toast("error", `导入失败：${(err as Error).message}`);
      }
    },
    [toast],
  );

  const handleExportProjectJson = useCallback((id: string) => {
    window.open(`/api/projects/${encodeURIComponent(id)}/export`, "_blank");
  }, []);

  useBeatHint({
    enabled: beatHint,
    playing,
    beatTimes: beatTimeline?.times ?? [],
    timeSec: frame / spec.fps,
  });

  const audioUrl = selectedAudio ? `/api/audio/${selectedAudio.id}/media` : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">◍</span>
          <div>
            <h1>WaveMotion</h1>
            <p>音乐动态背景工作台</p>
          </div>
        </div>
        <div className="header-meta">
          {analysis && (
            <>
              <span className="pill">
                BPM <b className="mono">{analysis.bpm.toFixed(1)}</b>
              </span>
              <span className="pill">
                拍点 <b className="mono">{analysis.beatsSec.length}</b>
              </span>
              <span className="pill">
                时长 <b className="mono">{analysis.durationSec.toFixed(2)}s</b>
              </span>
              <span className={`pill${analysis.rhythm.needsCorrection ? " pill-warn" : ""}`}>
                {analysis.rhythm.needsCorrection ? "节奏待校正" : "节奏稳定"}
              </span>
            </>
          )}
          {analyzing && <span className="pill pill-busy">分析中…</span>}
        </div>
      </header>

      <div className="app-body">
        {/* 左侧：音频 + 模板 */}
        <aside className="sidebar-left">
          <AudioPanel
            audioList={audioList}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onImport={handleImportAudio}
            onRefresh={handleRefreshAudio}
            importing={importing}
            analyzing={analyzing}
          />
          <div className="panel-section">
            <div className="panel-head">
              <h2>视觉模板</h2>
            </div>
            <TemplatePicker value={visual.template} onChange={handleTemplateChange} />
          </div>
          <ProjectPanel
            projects={projects}
            onSave={handleSaveProject}
            onLoad={handleLoadProject}
            onDelete={handleDeleteProject}
            onImport={handleImportProject}
            onExportJson={handleExportProjectJson}
          />
        </aside>

        {/* 中央：预览 + 波形 + 传输控制 */}
        <main className="stage">
          {analysisError && <div className="banner banner-error">{analysisError}</div>}
          <div className="stage-preview">
            <PreviewStage
              analysis={analysis}
              visual={visual}
              output={output}
              durationSec={durationSec}
              onFrame={setFrame}
              onPlayingChange={setPlaying}
              playerRef={playerRef}
              seekRequest={seekRequest}
              onSeekHandled={() => setSeekRequest(null)}
            />
          </div>
          {analysis && beatTimeline && (
            <TimelineScrubber
              analysis={analysis}
              timeline={beatTimeline}
              frame={frame}
              totalFrames={totalFrames}
              fps={spec.fps}
              onSeekFrame={handleSeek}
              loopRange={loopRange}
              onSetLoop={setLoopRange}
            />
          )}
          <Transport
            frame={frame}
            totalFrames={totalFrames}
            fps={spec.fps}
            playing={playing}
            onToggle={handleToggle}
            onSeekFrame={handleSeek}
            loopRange={loopRange}
            onSetLoop={setLoopRange}
            beatHintEnabled={beatHint}
            onToggleBeatHint={() => setBeatHint((v) => !v)}
            durationSec={durationSec}
          />
        </main>

        {/* 右侧：参数 */}
        <aside className="sidebar-right">
          <div className="section">
            <h3 className="section-title">常用参数</h3>
            <PalettePicker
              palette={visual.palette}
              customColors={visual.customColors}
              onChange={(palette: PaletteId) => updateVisual({ palette })}
              onCustomColors={(customColors) => updateVisual({ customColors })}
            />
            <Slider
              label="动感强度"
              value={visual.intensity}
              min={0.1}
              max={1}
              step={0.01}
              onChange={(intensity) => updateVisual({ intensity })}
            />
            <Slider
              label="响应灵敏度"
              value={visual.sensitivity}
              min={0.4}
              max={2}
              step={0.01}
              onChange={(sensitivity) => updateVisual({ sensitivity })}
            />
            <Slider
              label="背景亮度"
              value={visual.backgroundBrightness}
              min={0}
              max={1}
              step={0.01}
              onChange={(backgroundBrightness) => updateVisual({ backgroundBrightness })}
            />
            <label className="field field-inline">
              <span>自动变化</span>
              <input
                type="checkbox"
                checked={visual.autoVariation}
                onChange={(e) => updateVisual({ autoVariation: e.target.checked })}
              />
            </label>
          </div>

          <TemplateParamControls
            template={visual.template}
            params={visual.templateParams}
            onChange={handleParamChange}
          />

          {analysis && (
            <RhythmPanel
              analysis={analysis}
              rhythm={visual.rhythm}
              onChange={handleRhythmChange}
              onRestoreAuto={handleRestoreAuto}
            />
          )}

          <ExportPanel
            output={output}
            onOutputChange={setOutput}
            durationSec={durationSec}
            jobs={jobs}
            onExport={handleExport}
            onCancel={handleCancelJob}
            onRetry={handleRetryJob}
            onClearFinished={handleClearFinished}
            exporting={false}
          />
        </aside>
      </div>

      {audioUrl && (
        <audio
          ref={audioElRef}
          src={audioUrl}
          preload="auto"
          onEnded={() => playerRef.current?.pause()}
          style={{ display: "none" }}
        />
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
};
