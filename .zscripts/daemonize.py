#!/usr/bin/env python3
"""
Демонизатор для стенда: двойной форк (внук переходит под PID 1 и
переживает завершение команды). Использование:

  python3 .zscripts/daemonize.py --name ws  -- bash -c 'cd /home/z/my-project && exec npm run ws'
  python3 .zscripts/daemonize.py --name paddle -- bash -c '...'

PID пишется в /tmp/daemon-<name>.pid. Лог — в /tmp/daemon-<name>.log.
Если сервис с таким именем уже жив — ничего не делает (idempotent).
"""
import argparse
import os
import subprocess
import sys
import time


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, ValueError):
        return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', required=True)
    ap.add_argument('--check', default='', help='URL health-check после старта (curl -s)')
    ap.add_argument('cmd', nargs='+')
    args = ap.parse_args()

    pidfile = f'/tmp/daemon-{args.name}.pid'
    if os.path.exists(pidfile):
        try:
            old = int(open(pidfile).read().strip())
            if alive(old):
                print(f'[{args.name}] уже запущен (PID {old})')
                return
        except (ValueError, OSError):
            pass

    pid = os.fork()
    if pid:
        os.waitpid(pid, 0)
        return
    # первый ребёнок
    os.setsid()
    pid2 = os.fork()
    if pid2:
        os._exit(0)
    # внук — под PID 1
    log = open(f'/tmp/daemon-{args.name}.log', 'ab', buffering=0)
    os.dup2(log.fileno(), 1)
    os.dup2(log.fileno(), 2)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    with open(pidfile, 'w') as f:
        f.write(str(os.getpid()))
    os.execvp(args.cmd[0], args.cmd)


if __name__ == '__main__':
    main()
