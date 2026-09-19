#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_dir="$repo_root/.run"
pid_file="$run_dir/gemma4.pid"
log_file="$run_dir/gemma4.log"

mkdir -p "$run_dir"

if [[ -f "$pid_file" ]]; then
  old_pid="$(<"$pid_file")"
  if kill -0 "$old_pid" 2>/dev/null; then
    echo "Gemma 4 server is already running (PID $old_pid)."
    exit 0
  fi
fi

nohup setsid "$repo_root/scripts/serve_gemma4.sh" "$@" >"$log_file" 2>&1 </dev/null &
server_pid=$!
printf '%s\n' "$server_pid" >"$pid_file"

sleep 2
if kill -0 "$server_pid" 2>/dev/null; then
  echo "Gemma 4 server started (PID $server_pid)."
  echo "Logs: $log_file"
  echo "The first launch downloads and loads the model, which can take several minutes."
else
  echo "Server exited during startup. Recent logs:" >&2
  tail -80 "$log_file" >&2
  exit 1
fi
