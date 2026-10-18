"""Signal and decoder regressions. All fixtures are synthetic and temporary."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import librosa
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("analysis", ROOT / "python/analyze.py")
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)
FFMPEG = os.environ.get("WAVEMOTION_FFMPEG") or "ffmpeg"


class AnalysisRegressionTests(unittest.TestCase):
    def test_spectrum_tracks_frequency_changes_at_the_correct_time(self):
        sr = analysis.ANALYSIS_SR
        t = np.arange(sr) / sr
        # The bass occupies the first second; a high tone occupies the second.
        y = np.concatenate([.2 * np.sin(2*np.pi*100*t), .2 * np.sin(2*np.pi*3000*t)])
        mag = np.abs(librosa.stft(y, n_fft=1024, hop_length=analysis.HOP))
        times = librosa.frames_to_time(np.arange(mag.shape[1]), sr=sr, hop_length=analysis.HOP)
        flat, *_ = analysis.frame_energy(np.zeros(len(times)), np.ones(len(times)),
                                        np.zeros(len(times)), mag, sr, times, 2.0)
        spectrum = np.asarray(flat).reshape(120, 32)
        edges = np.geomspace(40, 16000, 33)
        bass, treble = [np.searchsorted(edges, hz)-1 for hz in (100, 3000)]
        self.assertGreater(spectrum[20:40, bass].mean(), .8)
        self.assertLess(spectrum[80:100, bass].mean(), .1)
        self.assertLess(spectrum[20:40, treble].mean(), .1)
        self.assertGreater(spectrum[80:100, treble].mean(), .8)

    def test_quiet_band_energy_remains_nonzero_and_monotonic(self):
        amplitudes = np.asarray([.001, .002, .004, .008, .016, .032])
        mag = np.tile(amplitudes, (513, 1))
        times = np.arange(6) / 60
        _, low, mid, high, *_ = analysis.frame_energy(np.zeros(6), np.ones(6),
            np.zeros(6), mag, analysis.ANALYSIS_SR, times, .1)
        for series in (low, mid, high):
            self.assertTrue(np.all(np.asarray(series) > 0))
            self.assertTrue(np.all(np.diff(series) > 0))
            self.assertLessEqual(max(series), 1)

    def test_m4a_aac_opus_and_webm_decode_and_preserve_metadata(self):
        with tempfile.TemporaryDirectory(prefix="wm-codecs-") as tmp:
            tmp = Path(tmp)
            sr = 44100
            t = np.arange(sr) / sr
            stereo = np.column_stack([.2*np.sin(2*np.pi*310*t), .1*np.sin(2*np.pi*620*t)])
            source = tmp / "source.wav"
            sf.write(source, stereo, sr)
            for ext, codec, expected_sr in [("m4a", "aac", sr), ("aac", "aac", sr),
                                            ("opus", "libopus", 48000), ("webm", "libopus", 48000)]:
                target = tmp / f"sound.{ext}"
                subprocess.run([FFMPEG, "-v", "error", "-i", str(source), "-c:a", codec,
                                str(target)], check=True)
                with self.subTest(format=ext):
                    y, decoded_sr, orig_sr, channels, duration = analysis.load_audio(target)
                    self.assertEqual(decoded_sr, analysis.ANALYSIS_SR)
                    self.assertEqual(orig_sr, expected_sr)
                    self.assertEqual(channels, 2)
                    self.assertLess(abs(duration-1), .1)
                    self.assertGreater(np.max(np.abs(y)), .02)
                    self.assertTrue(np.isfinite(y).all())
            output = tmp / "analysis.json"
            subprocess.run([sys.executable, str(ROOT / "python/analyze.py"), "--input",
                            str(tmp / "sound.m4a"), "--output", str(output)], check=True,
                            capture_output=True)
            result = json.loads(output.read_text())
            self.assertEqual(result["analysisVersion"], analysis.ANALYSIS_VERSION)
            self.assertEqual(len(result["spectrumFlat"]), len(result["rms"])*32)
            self.assertEqual(result["channels"], 2)

    def test_corrupt_audio_and_missing_tools_have_readable_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.m4a"
            bad.write_bytes(b"not audio")
            with self.assertRaisesRegex(ValueError, "无法读取音频"):
                analysis.load_audio(bad)
            with patch.dict(os.environ, {"WAVEMOTION_FFPROBE": str(Path(tmp)/"missing")}):
                with self.assertRaisesRegex(ValueError, "未找到 FFprobe"):
                    analysis.load_audio(bad)


if __name__ == "__main__":
    unittest.main()
