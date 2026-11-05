#!/usr/bin/env python3
"""Portable outer app launcher; deployment supplies host locations, never a run root."""
import json
import os
from pathlib import Path
import sys


def main():
    root = Path(__file__).resolve().parent
    check = len(sys.argv) == 3 and sys.argv[1] == '--check-binding'
    if not check and len(sys.argv) != 1:
        raise ValueError('arguments')
    config_path = Path(sys.argv[2]).resolve() if check else root / 'config.json'
    if config_path.parent != root:
        raise ValueError('config binding')
    config = json.loads(config_path.read_text())
    lease_path = root / 'lease.json'
    if Path(config['app']).resolve() != Path(__file__).resolve():
        raise ValueError('launcher binding')
    if Path(config['leaseFile']).resolve() != lease_path:
        raise ValueError('lease binding')
    vaults = {Path(path).resolve() for path in config['vaults']}
    if not vaults or any(not path.is_relative_to(root / 'mount') for path in vaults):
        raise ValueError('vault binding')
    host = json.loads((root / 'app-launcher.json').read_text())
    executable, registry = Path(host['executable']), Path(host['registry'])
    if not executable.is_absolute() or not executable.is_file() or not registry.is_absolute():
        raise ValueError('host locations')
    if check:
        print(json.dumps(dict(category='launcher-binding-verified', runRoot=str(root),
                              config=str(config_path), lease=str(lease_path), launchRequested=False)))
        return
    lease = json.loads(lease_path.read_text())
    os.kill(lease['pid'], 0)
    data = json.loads(registry.read_text())
    matched = set()
    for row in data.get('vaults', {}).values():
        path = Path(row['path']).resolve()
        if path in vaults:
            row['open'] = True
            matched.add(path)
    if matched != vaults:
        raise ValueError('registry binding')
    registry.write_text(json.dumps(data))
    os.execv(str(executable), [str(executable)])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never print raw exception messages, arguments, registry data or stacks.
        print(json.dumps(dict(category='launcher-binding-failed', kind=type(error).__name__)), file=sys.stderr)
        sys.exit(1)
