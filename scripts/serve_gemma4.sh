#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

vllm_venv="${VLLM_VENV:-$repo_root/.venv}"
if [[ ! -x "$vllm_venv/bin/vllm" ]]; then
  echo "vLLM is missing from $vllm_venv. Run scripts/setup_vllm.sh or set VLLM_VENV to an existing vLLM environment in .env." >&2
  exit 1
fi

model_id="${MODEL_ID:-google/gemma-4-12B-it}"
served_name="${SERVED_MODEL_NAME:-gemma-4-12b-it}"
host="${HOST:-0.0.0.0}"
port="${PORT:-8000}"
max_model_len="${MAX_MODEL_LEN:-8192}"
gpu_memory_utilization="${GPU_MEMORY_UTILIZATION:-0.80}"
dtype="${DTYPE:-bfloat16}"

export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda-13.0}"
export PATH="$CUDA_HOME/bin:$vllm_venv/bin:$PATH"
export HF_HOME="${HF_HOME:-$HOME/.cache/huggingface}"

args=(
  serve "$model_id"
  --served-model-name "$served_name"
  --host "$host"
  --port "$port"
  --dtype "$dtype"
  --max-model-len "$max_model_len"
  --gpu-memory-utilization "$gpu_memory_utilization"
  --enable-prefix-caching
)

if [[ -n "${VLLM_API_KEY:-}" ]]; then
  args+=(--api-key "$VLLM_API_KEY")
fi

# This launcher setting is not a vLLM runtime setting.
unset VLLM_VENV
exec "$vllm_venv/bin/vllm" "${args[@]}" "$@"

