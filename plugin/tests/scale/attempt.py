#!/usr/bin/env python3
"""Portable, detached attempt ownership for the desktop scale harness (Unix)."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid


def atomic_json(path, value):
    pending = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with pending.open('x') as stream:
            os.chmod(pending, 0o600)
            json.dump(value, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        pending.replace(path)
    finally:
        pending.unlink(missing_ok=True)


@contextlib.contextmanager
def locked(path, blocking=True):
    with path.open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def validate(spec):
    for key in ('command', 'cleanupCommand'):
        command = spec.get(key)
        if command is None and key == 'cleanupCommand':
            continue
        if not isinstance(command, list) or not command or not all(isinstance(x, str) and x for x in command):
            raise ValueError(key + ' must be a nonempty argument array')
    if not Path(spec['cwd']).is_absolute() or not Path(spec['cwd']).is_dir():
        raise ValueError('cwd must be an existing absolute directory')
    deadline = spec.get('deadlineAt')
    if not isinstance(deadline, (int, float)) or not math.isfinite(deadline):
        raise ValueError('deadlineAt must be an absolute Unix timestamp in milliseconds')
    for key, default in [('terminateGraceSeconds', 30), ('cleanupTimeoutSeconds', 180), ('evidenceTimeoutSeconds', 180)]:
        value = spec.get(key, default)
        if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value <= 600:
            raise ValueError(key + ' must be between zero and 600 seconds')
    evidence = spec['evidence']
    if not Path(evidence['root']).is_absolute():
        raise ValueError('evidence root must be absolute')
    for path in evidence['paths']:
        if not isinstance(path, str) or Path(path).is_absolute() or '..' in Path(path).parts or path.startswith('-'):
            raise ValueError('evidence paths must be relative descendants')
    if not isinstance(evidence.get('exclude', []), list) or not all(isinstance(x, str) for x in evidence.get('exclude', [])):
        raise ValueError('evidence exclusions must be strings')


def read_status(directory):
    root = Path(directory).resolve()
    state = json.loads((root / 'status.json').read_text())
    try:
        with locked(root / 'run.lock', blocking=False):
            alive = False
    except BlockingIOError:
        alive = True
    state['directory'] = str(root)
    state['supervisorAlive'] = alive
    starting = state['phase'] == 'starting' and time.time() * 1000 - state['createdAt'] < 5000
    state['availability'] = ('finished' if state['phase'] == 'finished' else
                             'running' if alive else 'starting' if starting else 'orphaned')
    spec = json.loads((root / 'spec.json').read_text())
    if spec.get('progressFile'):
        try:
            state['progress'] = json.loads(Path(spec['progressFile']).read_text())
        except (OSError, ValueError) as error:
            state['progressUnavailable'] = type(error).__name__
    return state


def start_attempt(directory, input_file):
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    root = Path(directory).resolve()
    spec = json.loads(Path(input_file).read_text())
    validate(spec)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with locked(root / 'start.lock'):
        if (root / 'spec.json').exists():
            if json.loads((root / 'spec.json').read_text()) != spec:
                raise RuntimeError('attempt already has a different specification; attach by identity')
            return read_status(root)
        else:
            if spec['deadlineAt'] <= time.time() * 1000:
                raise ValueError('attempt deadline has already expired')
            atomic_json(root / 'spec.json', spec)
            atomic_json(root / 'status.json', dict(schema=1, token=uuid.uuid4().hex, phase='starting',
                                                  createdAt=int(time.time() * 1000), deadlineAt=spec['deadlineAt']))
            with (root / 'attempt.log').open('ab') as log:
                os.chmod(root / 'attempt.log', 0o600)
                child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'worker', str(root)],
                                         stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                         close_fds=True, start_new_session=True)
            atomic_json(root / 'launch.json', dict(pid=child.pid))
    # A lost reply never authorizes a second spawn. A subsequent start only reads this identity.
    end = time.monotonic() + 5
    while time.monotonic() < end:
        state = read_status(root)
        if state['phase'] != 'starting':
            return state
        time.sleep(.02)
    return read_status(root)


def signal_group(pid, sig):
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        pass


def group_alive(pid):
    try:
        os.killpg(pid, 0)
        return True
    except ProcessLookupError:
        return False


def run_command(command, cwd, deadline, grace, log, cancelled=lambda: False, started=lambda pid: None):
    child = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                             close_fds=True, start_new_session=True)
    timed_out = was_cancelled = False
    try:
        started(child.pid)
        while child.poll() is None:
            was_cancelled = cancelled()
            timed_out = time.monotonic() >= deadline
            if was_cancelled or timed_out:
                break
            time.sleep(.05)
    finally:
        # Reap the complete owned group, including descendants left by an exited parent.
        if group_alive(child.pid):
            signal_group(child.pid, signal.SIGTERM)
            end = time.monotonic() + grace
            while group_alive(child.pid) and time.monotonic() < end:
                child.poll()
                time.sleep(.02)
            signal_group(child.pid, signal.SIGKILL)
        child.wait()
    return dict(pid=child.pid, returncode=child.returncode, timedOut=timed_out, cancelled=was_cancelled)


def export_evidence(root, spec, state, log):
    atomic_json(root / 'result.json', state)
    evidence = spec['evidence']
    source = Path(evidence['root'])
    present = [path for path in evidence['paths'] if (source / path).exists()]
    missing = [path for path in evidence['paths'] if path not in present]
    temporary = root / 'evidence.pending.tgz'
    command = ['tar', '-czf', str(temporary)]
    command += ['--exclude=' + value for value in evidence.get('exclude', [])]
    command += ['-C', str(root), 'result.json', 'attempt.log']
    if present:
        command += ['-C', str(source), *present]
    result = run_command(command, root, time.monotonic() + spec.get('evidenceTimeoutSeconds', 180),
                         spec.get('terminateGraceSeconds', 30), log)
    if result['returncode'] != 0 or result['timedOut']:
        raise RuntimeError('evidence export failed: ' + json.dumps(result))
    archive = root / 'evidence.tgz'
    temporary.replace(archive)
    receipt = dict(file=archive.name, bytes=archive.stat().st_size, sha256=digest(archive), missing=missing)
    atomic_json(root / 'evidence.json', receipt)
    return receipt


def worker(directory):
    root = Path(directory).resolve()
    # No inherited stdin, transport, parent PID or session heartbeat owns this lifetime.
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    stopping = []
    signal.signal(signal.SIGTERM, lambda *_: stopping.append(True))
    signal.signal(signal.SIGINT, lambda *_: stopping.append(True))
    with locked(root / 'run.lock', blocking=False), (root / 'attempt.log').open('ab', buffering=0) as log:
        spec = json.loads((root / 'spec.json').read_text())
        state = json.loads((root / 'status.json').read_text())
        state.update(phase='running', pid=os.getpid(), startedAt=int(time.time() * 1000))
        persist = lambda: atomic_json(root / 'status.json', state)
        persist()
        grace = spec.get('terminateGraceSeconds', 30)
        try:
            def started(pid):
                state['commandPid'] = pid
                persist()
            state['command'] = run_command(spec['command'], spec['cwd'],
                                           time.monotonic() + max(0, spec['deadlineAt'] / 1000 - time.time()),
                                           grace, log, lambda: bool(stopping) or (root / 'stop-requested').exists(), started)
            result = state['command']
            state['outcome'] = ('timed-out' if result['timedOut'] else 'cancelled' if result['cancelled'] else
                                'succeeded' if result['returncode'] == 0 else 'failed')
        except Exception as error:
            state.update(outcome='failed', commandError=str(error))
        finally:
            state['phase'] = 'cleanup'
            persist()
            try:
                if spec.get('cleanupCommand'):
                    state['cleanup'] = run_command(spec['cleanupCommand'], spec['cwd'],
                                                   time.monotonic() + spec.get('cleanupTimeoutSeconds', 180), grace, log)
                    if state['cleanup']['returncode'] != 0 or state['cleanup']['timedOut']:
                        state['outcome'] = 'failed'
            except Exception as error:
                state.update(outcome='failed', cleanupError=str(error))
            state['phase'] = 'exporting'
            persist()
            try:
                state['evidence'] = export_evidence(root, spec, state, log)
            except Exception as error:
                state.update(outcome='failed', evidenceError=str(error))
            state.update(phase='finished', finishedAt=int(time.time() * 1000))
            persist()


def verified_archive(directory):
    root = Path(directory).resolve()
    state = read_status(root)
    if state['phase'] != 'finished' or not state.get('evidence'):
        raise RuntimeError('attempt has no finished evidence; inspect status and retained scratch')
    archive = root / state['evidence']['file']
    if archive.stat().st_size != state['evidence']['bytes'] or digest(archive) != state['evidence']['sha256']:
        raise RuntimeError('evidence checksum mismatch')
    return archive, state


def main():
    arguments = sys.argv[1:]
    as_json = '--json' in arguments
    arguments = [arg for arg in arguments if arg != '--json']
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'worker', 'status', 'list', 'wait', 'collect', 'export', 'stop'])
    parser.add_argument('directory')
    parser.add_argument('file', nargs='?')
    parser.add_argument('--timeout', type=float, default=30)
    args = parser.parse_args(arguments)
    root = Path(args.directory).resolve()
    if args.action == 'worker':
        worker(root)
        return
    if args.action == 'start':
        value = start_attempt(root, args.file)
    elif args.action == 'list':
        value = [read_status(path) for path in sorted(root.iterdir()) if (path / 'status.json').is_file()]
    elif args.action == 'wait':
        end = time.monotonic() + args.timeout
        while True:
            value = read_status(root)
            if value['phase'] == 'finished' or value['availability'] == 'orphaned' or time.monotonic() >= end:
                break
            time.sleep(.1)
    elif args.action in ('collect', 'export'):
        archive, state = verified_archive(root)
        if args.action == 'export':
            with archive.open('rb') as stream:
                shutil.copyfileobj(stream, sys.stdout.buffer)
            return
        destination = Path(args.file).resolve()
        if destination.exists():
            if digest(destination) != state['evidence']['sha256']:
                raise RuntimeError('collection destination contains different evidence')
        else:
            temporary = destination.with_name(destination.name + '.partial-' + uuid.uuid4().hex)
            try:
                shutil.copyfile(archive, temporary)
                if digest(temporary) != state['evidence']['sha256']:
                    raise RuntimeError('collected evidence checksum mismatch')
                temporary.replace(destination)
            finally:
                temporary.unlink(missing_ok=True)
        value = dict(destination=str(destination), **state['evidence'])
    elif args.action == 'stop':
        value = read_status(root)
        if value['phase'] != 'finished':
            (root / 'stop-requested').touch()
    else:
        value = read_status(root)
    if as_json:
        print(json.dumps(value, sort_keys=True))
    elif isinstance(value, list):
        for item in value:
            print(item['directory'] + ': ' + item['phase'] + ' ' + item.get('outcome', ''))
    elif 'destination' in value:
        print('Evidence collected: ' + value['destination'])
    else:
        print(value['directory'] + ': ' + value['phase'] + ' ' + value.get('outcome', ''))
        if value.get('progress'):
            print('Progress: ' + str(value['progress'].get('phase', 'available')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
