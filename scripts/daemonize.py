#!/usr/bin/env python3
"""Daemonización por doble fork: reparenta al hijo a PID 1 (tini),
igual que hace el demonio de agent-browser, que sobrevive al reaper."""
import os
import sys
import subprocess

def daemonize(cmd):
    if os.fork() > 0:
        os._exit(0)  # primer padre sale
    os.setsid()
    if os.fork() > 0:
        os._exit(0)  # segundo padre sale -> nieto queda huérfano, adoptado por PID 1
    # redirigir stdio a /dev/null
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 0)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    os.execvp(cmd[0], cmd)

if __name__ == "__main__":
    daemonize(sys.argv[1:])
