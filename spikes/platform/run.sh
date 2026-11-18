#!/usr/bin/env bash
# 用 ego-browser 跑一个探针脚本。脚本在 ego 的 Node 进程里执行，读不到本 shell 的 cwd 和环境变量，
# 所以这里把工作树路径和参数写成全局变量放在脚本前面。
# 用法：spikes/platform/run.sh spikes/platform/spaces.mjs ['{"handoff":true}']
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$1"
ARGS="${2:-}"; [ -n "$ARGS" ] || ARGS="{}"
{
  printf 'globalThis.SPIKE_ROOT = %s;\n' "$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$ROOT")"
  printf 'globalThis.ARGS = %s;\n' "$ARGS"
  cat "$SCRIPT"
} | ego-browser nodejs
