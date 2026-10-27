#!/usr/bin/env python3
"""Двойной fork: процесс отвязывается от сессии терминала и переживает её закрытие.
Использование: python3 daemonize.py <logfile> <command> [args...]"""
import os, sys

def daemonize():
    if os.fork() > 0: os._exit(0)
    os.setsid()
    if os.fork() > 0: os._exit(0)
    sys.stdout.flush(); sys.stderr.flush()
    with open(os.devnull, 'rb') as f: os.dup2(f.fileno(), 0)

log = sys.argv[1]; cmd = sys.argv[2:]
fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
daemonize()
os.dup2(fd, 1); os.dup2(fd, 2); os.close(fd)
os.execvp(cmd[0], cmd)
