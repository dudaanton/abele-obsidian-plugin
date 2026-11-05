// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { deployAppLauncher, verifyAppLauncher } from './app-launcher.mjs'

it('binds the deployed launcher to its own workspace and checks it without launching', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'scale-launcher-'))
  try {
    const root = join(parent, 'current run')
    await mkdir(root)
    const registry = join(parent, 'registry.json')
    const before = '{"vaults":{}}\n'
    await writeFile(registry, before)
    const app = await deployAppLauncher(root, { executable: process.execPath, registry })
    const config = join(root, 'config.json')
    await writeFile(config, JSON.stringify({ app, leaseFile: join(root, 'lease.json'),
      vaults: [join(root, 'mount', 'sample-a'), join(root, 'mount', 'sample-b')] }))
    const receipt = await verifyAppLauncher(root, config)
    expect(receipt).toMatchObject({ category: 'launcher-binding-verified', runRoot: root,
      config, lease: join(root, 'lease.json'), launchRequested: false })
    expect(await readFile(registry, 'utf8')).toBe(before)
    // A stale run config cannot bind the helper to another run's lease or launcher.
    for (const change of [{ leaseFile: join(parent, 'old', 'lease.json') },
      { app: join(parent, 'old', 'launch-app.py') }, { vaults: [join(parent, 'old', 'vault')] }]) {
      await writeFile(config, JSON.stringify({ app, leaseFile: join(root, 'lease.json'),
        vaults: [join(root, 'mount', 'sample-a')], ...change }))
      await expect(verifyAppLauncher(root, config)).rejects.toThrow('App launcher binding refused')
    }
  } finally { await rm(parent, { recursive: true, force: true }) }
})

it('rejects an old deployed helper before executing it, even if it ignores check arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scale-launcher-'))
  try {
    const app = await deployAppLauncher(root, { executable: process.execPath, registry: join(root, 'registry.json') })
    await writeFile(app, 'raise RuntimeError("old workspace launcher must not execute")\n')
    await expect(verifyAppLauncher(root, join(root, 'config.json'))).rejects.toThrow('Deployed app launcher differs')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('normal execution uses the same binding and activates only its vaults before a fake app', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scale-launcher-'))
  try {
    const executable = join(root, 'fake-app.py'), registry = join(root, 'registry.json')
    await writeFile(executable, '#!/usr/bin/env python3\nfrom pathlib import Path\nPath(__file__).with_name("launched").write_text("fake app")\n', { mode: 0o700 })
    const vault = join(root, 'mount', 'sample')
    await writeFile(registry, JSON.stringify({ vaults: { current: { path: vault, open: false },
      other: { path: join(root, 'unrelated'), open: false } } }))
    const app = await deployAppLauncher(root, { executable, registry })
    const config = join(root, 'config.json')
    await writeFile(config, JSON.stringify({ app, leaseFile: join(root, 'lease.json'), vaults: [vault] }))
    await writeFile(join(root, 'lease.json'), JSON.stringify({ pid: process.pid }))
    await verifyAppLauncher(root, config)
    await expect(readFile(join(root, 'launched'))).rejects.toThrow()
    await promisify(execFile)('python3', [app], { cwd: tmpdir() })
    expect(await readFile(join(root, 'launched'), 'utf8')).toBe('fake app')
    const state = JSON.parse(await readFile(registry, 'utf8'))
    expect(state.vaults.current.open).toBe(true)
    expect(state.vaults.other.open).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
