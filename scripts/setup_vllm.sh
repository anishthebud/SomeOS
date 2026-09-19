#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

python_bin="${PYTHON_BIN:-python3}"
torch_backend="${VLLM_TORCH_BACKEND:-cu130}"
cuda_home="${CUDA_HOME:-/usr/local/cuda-13.0}"

python_include="$("$python_bin" -c 'import sysconfig; print(sysconfig.get_path("include"))')"
if [[ ! -f "$python_include/Python.h" ]]; then
  python_version="$("$python_bin" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  echo "Missing $python_include/Python.h, which Triton needs to compile its CUDA helper." >&2
  echo "On Ubuntu, install it with: sudo apt-get install -y python${python_version}-dev" >&2
  exit 1
fi

git submodule update --init --recursive third_party/vllm

if [[ ! -x .venv/bin/python ]]; then
  "$python_bin" -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip uv

export CUDA_HOME="$cuda_home"
export PATH="$CUDA_HOME/bin:$repo_root/.venv/bin:$PATH"
export VLLM_USE_PRECOMPILED=1

.venv/bin/uv pip install \
  --python .venv/bin/python \
  --editable third_party/vllm \
  --torch-backend="$torch_backend"

.venv/bin/python - <<'PY'
import torch
import vllm

print(f"vLLM: {vllm.__version__}")
print(f"PyTorch: {torch.__version__} (CUDA {torch.version.cuda})")
print(f"CUDA available: {torch.cuda.is_available()}")
if not torch.cuda.is_available():
    raise SystemExit("CUDA is not available to PyTorch")
print(f"GPU: {torch.cuda.get_device_name(0)}")
print(f"Compute capability: {torch.cuda.get_device_capability(0)}")
print(f"Unified memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.2f} GiB")
PY
