#!/usr/bin/env bash
# 创建隔离的 Python 环境并安装分析依赖。
# 不污染全局 Python；重复执行是安全的（已存在则复用）。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VENV_DIR="$ROOT_DIR/.venv"
REQ_FILE="$ROOT_DIR/python/requirements.txt"
PY_MIN_MINOR=12

log() { printf '\033[36m[setup:python]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[setup:python]\033[0m %s\n' "$*" >&2; }

find_python() {
  # 优先用环境变量指定，其次 3.12 / 3.13，最后退回 python3
  local cand
  for cand in "${WAVEMOTION_PYTHON:-}" python3.12 python3.13 python3; do
    [ -n "$cand" ] || continue
    if command -v "$cand" >/dev/null 2>&1; then
      if "$cand" -c "import sys; sys.exit(0 if sys.version_info >= (3, ${PY_MIN_MINOR}) else 1)" 2>/dev/null; then
        command -v "$cand"
        return 0
      fi
    fi
  done
  return 1
}

if [ -x "$VENV_DIR/bin/python" ]; then
  log "复用已有环境：$VENV_DIR"
else
  BASE_PY="$(find_python)" || {
    err "未找到 Python 3.${PY_MIN_MINOR}+。请先安装 Python 3.12 或更高版本。"
    err "macOS 可用 Homebrew：brew install python@3.12"
    exit 1
  }
  log "使用基础解释器：$BASE_PY ($("$BASE_PY" -V 2>&1))"
  log "创建虚拟环境：$VENV_DIR"
  "$BASE_PY" -m venv "$VENV_DIR"
fi

PY="$VENV_DIR/bin/python"
[ -x "$PY" ] || PY="$VENV_DIR/Scripts/python.exe"

log "安装依赖（$(basename "$REQ_FILE")）…"
"$PY" -m pip install --upgrade pip --quiet
"$PY" -m pip install -r "$REQ_FILE" --quiet

log "校验依赖…"
"$PY" - <<'PYCODE'
import sys
import librosa, numpy, scipy, soundfile
print(f"  Python {sys.version.split()[0]}")
print(f"  librosa {librosa.__version__} / numpy {numpy.__version__} / scipy {scipy.__version__} / soundfile {soundfile.__version__}")
PYCODE

log "完成。分析时会自动使用 $PY"
