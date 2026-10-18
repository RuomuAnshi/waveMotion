#!/usr/bin/env python3
"""WaveMotion 离线音频分析。

输入：音频文件路径
输出：JSON（结构见 src/shared/types.ts 的 AudioAnalysis，字段使用 camelCase）

仅使用降采样单声道副本做分析；不修改原始音频。被 Node 后台通过子进程调用。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

ANALYSIS_VERSION = "analysis-v1"
# 时间序列采样率（Hz）。视频 fps 最高 60，此处用 60Hz 足够且插值平滑。
SERIES_FPS = 60
# 分析用降采样目标（单声道）
ANALYSIS_SR = 22050
# stft hop，256/22050 ≈ 11.6ms，低于 60fps 的 16.7ms，保证节拍对齐精度
HOP = 256
# 频谱频段数
SPECTRUM_BANDS = 32

LOW_CUT_HZ = 250.0
HIGH_CUT_HZ = 2000.0


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def resample_series(values, src_times, duration: float, fps: int):
    """把不均匀/低频的时间序列线性重采样到统一的 fps 时间轴，长度 = ceil(duration*fps)。"""
    import numpy as np

    n = max(1, int(round(duration * fps)))
    if n <= 0:
        return [0.0] * 0
    dst_t = np.arange(n, dtype=np.float64) / fps
    src_t = np.asarray(src_times, dtype=np.float64)
    src_v = np.asarray(values, dtype=np.float64)
    if src_t.size == 0:
        return [0.0] * n
    out = np.interp(dst_t, src_t, src_v, left=float(src_v[0]), right=float(src_v[-1]))
    return [float(x) for x in out]


def normalize(values, percentile: float = 99.0):
    import numpy as np

    a = np.asarray(values, dtype=np.float64)
    if a.size == 0:
        return a
    hi = float(np.percentile(a, percentile))
    if hi <= 1e-9:
        hi = float(a.max()) if a.max() > 1e-9 else 1.0
    return np.clip(a / hi, 0.0, 1.0)


def mute_curve(rms_norm):
    """静音段衰减曲线：低于阈值的部分平滑衰到 0，避免抖动。"""
    import numpy as np

    a = np.asarray(rms_norm, dtype=np.float64)
    # 归一化响度低于 0.06 视为接近静音，0.06~0.2 之间平滑过渡
    t = np.clip((a - 0.06) / 0.14, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def detect_silent_intro(rms_db, times, peak_db, threshold_db=32.0, hold=0.25):
    """返回开头静音时长（秒）。静音定义为低于 peak-32dB 持续 hold 秒。"""
    import numpy as np

    if len(rms_db) == 0:
        return 0.0
    thresh = peak_db - threshold_db
    above = np.asarray(rms_db) > thresh
    if not np.any(above):
        return 0.0
    t = np.asarray(times)
    first = int(np.argmax(above))
    # 回退到真正开始前一点（起音有爬升）
    start = float(t[first])
    if start < hold:
        return 0.0
    # 确认 first 之后持续 above 至少 hold
    after = t[above]
    return float(after[0]) if len(after) else 0.0


def estimate_stability(beats):
    import numpy as np

    if len(beats) < 4:
        return 0.0, 0.0
    intervals = np.diff(np.asarray(beats))
    med = float(np.median(intervals))
    if med <= 1e-6:
        return 0.0, 0.0
    cv = float(np.std(intervals) / med)
    stability = clamp(1.0 - cv * 1.8)
    # 置信度：间隔一致性 + 拍点从起音序列中的相对强度
    confidence = stability
    return stability, confidence


def estimate_beat_strength(onset_env, onset_times, beats):
    """给每个拍点一个 0..1 的强度，用于幅度驱动。"""
    import numpy as np

    if len(beats) == 0:
        return []
    oe = np.asarray(onset_env, dtype=np.float64)
    ot = np.asarray(onset_times, dtype=np.float64)
    if oe.size == 0 or ot.size == 0:
        return [0.5] * len(beats)
    strengths = []
    for b in beats:
        idx = int(np.argmin(np.abs(ot - b)))
        lo = max(0, idx - 1)
        hi = min(len(oe), idx + 2)
        strengths.append(float(np.max(oe[lo:hi])))
    arr = np.asarray(strengths)
    hi = float(np.percentile(arr, 90)) if arr.size else 1.0
    if hi <= 1e-9:
        hi = 1.0
    return [float(clamp(x / hi)) for x in arr]


def spectrum_bands(stft_mag, sr, n_bands=SPECTRUM_BANDS):
    """对数分布的 n_bands 个频段能量（按频段内平均幅度）。返回 shape=(n_bands, frames)."""
    import numpy as np

    freqs = np.linspace(0.0, sr / 2.0, stft_mag.shape[0])
    # 对数分布边界：40Hz ~ 16kHz
    edges = np.geomspace(40.0, 16000.0, n_bands + 1)
    out = np.zeros((n_bands, stft_mag.shape[1]), dtype=np.float64)
    for b in range(n_bands):
        lo, hi = edges[b], edges[b + 1]
        mask = (freqs >= lo) & (freqs < hi)
        if not np.any(mask):
            mask = np.argmin(np.abs(freqs - (lo + hi) / 2)) == np.arange(len(freqs))
        out[b] = stft_mag[mask].mean(axis=0) if np.any(mask) else 0.0
    return out


def band_range_energy(stft_mag, sr, lo_hz, hi_hz):
    import numpy as np

    freqs = np.linspace(0.0, sr / 2.0, stft_mag.shape[0])
    mask = (freqs >= lo_hz) & (freqs < hi_hz)
    if not np.any(mask):
        return np.zeros(stft_mag.shape[1], dtype=np.float64)
    return stft_mag[mask].mean(axis=0)


def frame_energy(rms_db, rms_norm, onset_env_norm, stft_mag, sr, times, duration):
    """生成各能量序列并重采样到 SERIES_FPS。"""
    import numpy as np

    # ---- 频谱 32 频段 ----
    bands = spectrum_bands(stft_mag, sr)
    band_db = 20.0 * np.log10(bands + 1e-9)
    band_norm = np.zeros_like(band_db)
    for b in range(band_db.shape[0]):
        lo = float(np.percentile(band_db[b], 5))
        hi = float(np.percentile(band_db[b], 95))
        if hi - lo < 1e-6:
            band_norm[b] = 0.0
        else:
            band_norm[b] = np.clip((band_db[b] - lo) / (hi - lo), 0.0, 1.0)
    # 用响度做门限，静音时频谱归零
    gate = mute_curve(np.interp(times, times, rms_norm))
    gate_rs = np.interp(np.linspace(0, duration, band_norm.shape[1]), np.linspace(0, duration, len(gate)), gate)
    band_norm = band_norm * gate_rs[None, :]

    spectrum_flat = []
    for b in range(band_norm.shape[0]):
        spectrum_flat.extend(resample_series(band_norm[b], times, duration, SERIES_FPS))

    # ---- 低/中/高频 ----
    low = band_range_energy(stft_mag, sr, 30.0, LOW_CUT_HZ)
    mid = band_range_energy(stft_mag, sr, LOW_CUT_HZ, HIGH_CUT_HZ)
    high = band_range_energy(stft_mag, sr, HIGH_CUT_HZ, sr / 2.0)
    low_n = normalize(20.0 * np.log10(low + 1e-9), 98.0)
    mid_n = normalize(20.0 * np.log10(mid + 1e-9), 98.0)
    high_n = normalize(20.0 * np.log10(high + 1e-9), 98.0)
    low_n = low_n * mute_curve(rms_norm)
    mid_n = mid_n * mute_curve(rms_norm)
    high_n = high_n * mute_curve(rms_norm)

    low_ser = resample_series(low_n, times, duration, SERIES_FPS)
    mid_ser = resample_series(mid_n, times, duration, SERIES_FPS)
    high_ser = resample_series(high_n, times, duration, SERIES_FPS)
    rms_ser = resample_series(rms_norm, times, duration, SERIES_FPS)
    rmsdb_ser = resample_series(rms_db, times, duration, SERIES_FPS)
    onset_ser = resample_series(onset_env_norm, times, duration, SERIES_FPS)
    return spectrum_flat, low_ser, mid_ser, high_ser, rms_ser, rmsdb_ser, onset_ser


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--version", default=ANALYSIS_VERSION)
    args = ap.parse_args()

    t0 = time.time()
    import numpy as np
    import soundfile as sf
    import librosa

    in_path = Path(args.input)
    if not in_path.exists():
        print(json.dumps({"error": f"文件不存在: {in_path}"}), file=sys.stderr)
        return 2

    # 原始文件信息（保留原始声道数/采样率用于预览导出）
    try:
        info = sf.info(str(in_path))
        orig_sr = int(info.samplerate)
        orig_channels = int(info.channels)
        orig_frames = int(info.frames)
        duration = float(info.duration)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"无法读取音频: {exc}"}), file=sys.stderr)
        return 3
    if duration <= 0.05:
        print(json.dumps({"error": "音频时长过短"}), file=sys.stderr)
        return 3

    try:
        y, sr = librosa.load(str(in_path), sr=ANALYSIS_SR, mono=True, duration=None)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"音频解码失败: {exc}"}), file=sys.stderr)
        return 3
    if y.size == 0:
        print(json.dumps({"error": "音频为空"}), file=sys.stderr)
        return 3

    # 统一使用原始时长做时间轴（librosa 载入的时长可能因容器略有差异）
    duration = max(duration, y.size / float(sr))

    hop = HOP
    stft = np.abs(librosa.stft(y, n_fft=1024, hop_length=hop))
    times = librosa.frames_to_time(np.arange(stft.shape[1]), sr=sr, hop_length=hop)

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    onset_env = np.asarray(onset_env, dtype=np.float64)
    # onset_strength 帧数与 stft 可能差 1 帧，对齐长度
    n = min(len(onset_env), len(times))
    onset_env = onset_env[:n]
    times = times[:n]
    stft = stft[:, :n]

    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    rms = rms[:n]
    rms_db = 20.0 * np.log10(np.maximum(rms, 1e-8))
    rms_norm = normalize(rms, 97.0)
    onset_norm = normalize(onset_env, 97.0)

    # ---- 节拍检测 ----
    try:
        tempo, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset_env, sr=sr, hop_length=hop, units="frames", trim=True
        )
        beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
        tempo_val = float(np.atleast_1d(tempo)[0])
    except Exception:  # noqa: BLE001
        tempo_val, beat_times = 0.0, np.array([])
    beats = [float(b) for b in beat_times if 0.0 <= float(b) <= duration]
    if tempo_val <= 0 and len(beats) >= 3:
        iv = np.diff(np.asarray(beats))
        med = float(np.median(iv))
        tempo_val = 60.0 / med if med > 1e-6 else 0.0

    # 起音事件
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sr, hop_length=hop, units="frames", backtrack=True
    )
    onset_times = [float(t) for t in librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop) if 0.0 <= float(t) <= duration]

    beat_strengths = estimate_beat_strength(onset_env, times, beats)
    stability, confidence = estimate_stability(beats)

    peak_db = float(np.max(rms_db)) if rms_db.size else -120.0
    mean_db = float(np.mean(rms_db)) if rms_db.size else -120.0
    silent_intro = detect_silent_intro(rms_db, times, peak_db)
    silence_thresh = peak_db - 30.0
    silent_ratio = float(np.mean(np.asarray(rms_db) < silence_thresh)) if rms_db.size else 0.0

    warnings_list = []
    if silent_intro >= 0.4:
        warnings_list.append(f"开头约 {silent_intro:.1f} 秒为静音，起拍偏移可能需要手动校正")
    if mean_db < -34.0:
        warnings_list.append("整体音量偏低，画面动态可能较弱")
    if silent_ratio > 0.35:
        warnings_list.append("静音段落较多，静音段会自动降低运动强度")
    if tempo_val < 60.0 or tempo_val > 200.0:
        warnings_list.append(f"自动 BPM 为 {tempo_val:.1f}，超出常见范围，建议手动校正")
    if len(beats) < 4:
        warnings_list.append("检测到的拍点过少，建议手动输入 BPM")
    if stability < 0.55:
        warnings_list.append("节奏稳定性较低，建议在节奏校正中手动设定 BPM")

    needs_correction = bool(len(beats) < 4 or stability < 0.55 or tempo_val <= 0 or tempo_val < 50 or tempo_val > 210)
    if needs_correction:
        hint = "节奏检测不够可靠，建议使用手动 BPM 校正"
    else:
        hint = "节奏检测稳定，可直接使用自动拍点"

    spectrum_flat, low_ser, mid_ser, high_ser, rms_ser, rmsdb_ser, onset_ser = frame_energy(
        rms_db, rms_norm, onset_norm, stft, sr, times, duration
    )

    result = {
        "analysisVersion": args.version,
        "audioId": "",
        "durationSec": round(duration, 6),
        "sampleRate": orig_sr,
        "channels": orig_channels,
        "bpm": round(tempo_val, 4),
        "beatsSec": [round(b, 5) for b in beats],
        "onsetEventsSec": [round(o, 5) for o in onset_times],
        "beatStrengths": [round(s, 4) for s in beat_strengths],
        "frameRate": SERIES_FPS,
        "rms": [round(float(v), 5) for v in rms_ser],
        "rmsDb": [round(float(v), 3) for v in rmsdb_ser],
        "low": [round(float(v), 5) for v in low_ser],
        "mid": [round(float(v), 5) for v in mid_ser],
        "high": [round(float(v), 5) for v in high_ser],
        "onsetStrength": [round(float(v), 5) for v in onset_ser],
        "spectrumBands": SPECTRUM_BANDS,
        "spectrumFlat": [round(float(v), 5) for v in spectrum_flat],
        "loudness": {
            "peakDbfs": round(peak_db, 3),
            "silentIntroSec": round(silent_intro, 4),
            "silentRatio": round(silent_ratio, 4),
            "meanDbfs": round(mean_db, 3),
        },
        "rhythm": {
            "stability": round(stability, 4),
            "confidence": round(confidence, 4),
            "needsCorrection": needs_correction,
            "hint": hint,
            "beatStrengths": [round(s, 4) for s in beat_strengths],
        },
        "warnings": warnings_list,
        "elapsedMs": int((time.time() - t0) * 1000),
    }

    # 契约里起音事件字段名是 onsetsSec，这里统一输出两份兼容前端
    result["onsetsSec"] = result["onsetEventsSec"]
    del result["onsetEventsSec"]

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".tmp")
    tmp.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    tmp.replace(out)
    print(json.dumps({"ok": True, "output": str(out), "elapsedMs": result["elapsedMs"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
