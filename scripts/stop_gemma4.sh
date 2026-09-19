#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pid_file="$repo_root/.run/gemma4.pid"

if [[ ! -f "$pid_file" ]]; then
  echo "Gemma 4 server is not running (no PID file)."
  exit 0
fi

server_pid="$(<"$pid_file")"
if ! kill -0 "$server_pid" 2>/dev/null; then
  echo "Gemma 4 server is not running (stale PID file)."
  rm -f "$pid_file"
  exit 0
fi

server_command="$(ps -p "$server_pid" -o args= 2>/dev/null || true)"
if [[ "$server_command" != *"vllm"* ]]; then
  echo "Refusing to stop PID $server_pid because it is not a vLLM process." >&2
  exit 1
fi

server_pgid="$(ps -p "$server_pid" -o pgid= | tr -d ' ')"
if [[ "$server_pgid" == "$server_pid" ]]; then
  kill -TERM -- "-$server_pgid"
else
  kill -TERM "$server_pid"
fi
for _ in {1..30}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    rm -f "$pid_file"
    echo "Gemma 4 server stopped."
    exit 0
  fi
  sleep 1
done

echo "Server did not stop within 30 seconds; PID $server_pid is still running." >&2
exit 1
