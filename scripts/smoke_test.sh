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

host="${TEST_HOST:-127.0.0.1}"
port="${PORT:-8000}"
served_name="${SERVED_MODEL_NAME:-gemma-4-12b-it}"
base_url="http://$host:$port"

headers=(-H "Content-Type: application/json")
if [[ -n "${VLLM_API_KEY:-}" ]]; then
  headers+=(-H "Authorization: Bearer $VLLM_API_KEY")
fi

curl -fsS "${headers[@]}" "$base_url/v1/models" | .venv/bin/python -m json.tool

curl -fsS "${headers[@]}" \
  -X POST "$base_url/v1/chat/completions" \
  -d "{\"model\":\"$served_name\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: Hearth is ready\"}],\"max_tokens\":16,\"temperature\":0}" \
  | .venv/bin/python -m json.tool

