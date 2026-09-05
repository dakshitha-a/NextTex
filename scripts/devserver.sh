#!/usr/bin/env bash
# Start/stop/restart the development server, tracked by a pidfile.
# pkill -f matching on the module path also matches the shell that runs it,
# which is a good way to kill your own session; a pidfile does not.
set -uo pipefail
cd "$(dirname "$0")/.."
PIDFILE=/tmp/nexttex-dev.pid
LOG=${NEXTTEX_LOG:-/tmp/nexttex-dev.log}
# 8451, not 8450: the installed instance owns 8450, and a development
# server that silently takes its port is a confusing afternoon.
PORT=${NEXTTEX_PORT:-8451}

stop() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    sleep 1
    kill -9 "$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
  fi
}

case "${1:-start}" in
  stop) stop; echo "stopped" ;;
  start|restart)
    stop
    nohup .venv/bin/python -m uvicorn server.main:app \
      --host 127.0.0.1 --port "$PORT" > "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 4
    if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "running on http://127.0.0.1:$PORT (pid $(cat "$PIDFILE"), log $LOG)"
    else
      echo "failed to start; last lines of $LOG:"; tail -20 "$LOG"; exit 1
    fi ;;
  *) echo "usage: devserver.sh [start|stop|restart]"; exit 2 ;;
esac
