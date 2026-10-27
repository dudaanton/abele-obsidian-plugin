import { expect, it, vi } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

const data = (text: string) => new TextEncoder().encode(text)
it('waits for conditional effects encountered by a scan and retries its inventory', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content: 'before' }])
  const disk = new ObsidianFileSystem(app as never)
  const conditional = Reflect.get(disk, 'conditional')
  const active = (Reflect.get(conditional, 'host') as { active: Set<string> }).active
  const getFiles = app.vault.getFiles.bind(app.vault)
  let inventories = 0
  let edit: Promise<unknown> | undefined
  app.vault.getFiles = () => {
    inventories++
    if (inventories === 1) {
      const prior = getFiles()
      active.add('held-effect')
      edit = app.vault
        .create('during.md', 'during')
        .then(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))
        .finally(() => active.delete('held-effect'))
      return prior
    }
    return getFiles()
  }
  const listed: string[] = []
  const scan = (async () => {
    for await (const file of disk.list()) listed.push(file.path)
  })()
  await expect(scan).resolves.toBeUndefined()
  await edit
  expect(listed).toContain('sample.md')
  expect(listed).toContain('during.md')
  expect(listed).toHaveLength(2)
  expect(inventories).toBeGreaterThan(1)
})
const destructiveHostCase = (name: string, run: (desktop: boolean) => Promise<void>) => {
  it(name.replace('%s', 'false'), () => run(false))
  it(name.replace('%s', 'true'), () => run(true))
}

it('settles conditional recovery before legacy startup recovery can return early', async () => {
  const disk = new ObsidianFileSystem(buildFakeVault([]) as never)
  const recover = vi
    .spyOn(disk, 'recoverConditionalFiles')
    .mockRejectedValue(new Error('pending evidence'))
  await expect(disk.recover()).rejects.toThrow('pending evidence')
  expect(recover).toHaveBeenCalledOnce()
})
it('checks destructive removal by fresh content on a host without object identity', async () => {
  const app = buildFakeVault([])
  await app.vault.adapter.writeBinary('sample.bin', data('sample A').buffer, { mtime: 1000 })
  const disk = new ObsidianFileSystem(app as never)
  expect(
    await disk.conditionalFile({
      path: 'sample.bin',
      expected: { size: 8, mtime: 1000, sha: await sha256(data('sample A')) },
      effect: { kind: 'remove' },
    })
  ).toBe(true)
  expect(await app.vault.adapter.exists('sample.bin')).toBe(false)
})
it('separates retained victims from caller-owned installation evidence', async () => {
  const app = buildFakeVault([])
  desktopAdapter(app)
  const disk = new ObsidianFileSystem(app as never)
  await app.vault.adapter.writeBinary('sample.bin', data('sample A').buffer, { mtime: 1000 })
  expect(
    await disk.conditionalFile({
      path: 'sample.bin',
      expected: { size: 8, mtime: 1000, sha: await sha256(data('sample A')) },
      effect: { kind: 'write', bytes: data('sample B'), mtime: 2000, receipt: 'sample-retirement' },
    })
  ).toBe(true)
  const folder = '.obsidian/plugins/abele/sync-conditional/objects/sample-retirement'
  expect(await app.vault.adapter.exists(folder + '/victim')).toBe(false)
  expect(
    await app.vault.adapter.read(
      '.obsidian/plugins/abele/sync-conditional/trash/sample-retirement/victim'
    )
  ).toBe('sample A')
  expect(
    await disk.installedFile('sample-retirement', 'sample.bin', await sha256(data('sample B')))
  ).toBe(true)
  await disk.discardInstallation('sample-retirement')
  await disk.discardInstallation('sample-retirement')
  expect(await app.vault.adapter.exists(folder)).toBe(false)
  expect(await app.vault.adapter.read('sample.bin')).toBe('sample B')
})
it.each(['write', 'move', 'remove'] as const)(
  'routes the legacy %s entry point through conditional publication',
  async (kind) => {
    const app = buildFakeVault([])
    await app.vault.adapter.writeBinary('sample.bin', data('sample A').buffer, { mtime: 1000 })
    const disk = new ObsidianFileSystem(app as never)
    const gate = vi.spyOn(disk, 'conditionalFile').mockResolvedValue(false)
    const operation = () =>
      kind === 'write'
        ? disk.writeAtomic('sample.bin', data('sample B'), 1000)
        : kind === 'move'
          ? disk.move('sample.bin', 'other.bin')
          : disk.remove('sample.bin')
    await expect(operation()).rejects.toMatchObject({ code: 'conflict' })
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'sample.bin',
        expected: { size: 8, mtime: 1000, sha: await sha256(data('sample A')) },
        effect: expect.objectContaining({ kind }),
      })
    )
    expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(
      data('sample A')
    )
  }
)
function desktopAdapter(app: ReturnType<typeof buildFakeVault>) {
  withDesktopFs(app, { fenced: false })
  // Model hard links' preservation of the source timestamps (the generic fake copies bytes).
  const native = Reflect.get(app.vault.adapter, 'fsPromises')
  const link = native.link.bind(native)
  const aliases = new Map<string, number>()
  let nextInode = 0x100000000
  const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  app.vault.adapter.writeBinary = async (path, bytes, options) => {
    if (!(await app.vault.adapter.exists(path))) aliases.set('/vault/' + path, nextInode++)
    await write(path, bytes, options)
  }
  const lstat = native.lstat.bind(native)
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  native.stat = async (path: string) => {
    const info = await lstat(path)
    return { ...info, ino: aliases.get(path) ?? info.ino }
  }
  app.vault.adapter.rename = async (from: string, to: string) => {
    const identity = await native.stat('/vault/' + from)
    await rename(from, to)
    aliases.delete('/vault/' + from)
    aliases.set('/vault/' + to, identity.ino)
  }
  native.utimes = async (full: string, _atime: number, mtime: number) => {
    const path = full.slice('/vault/'.length)
    await app.vault.adapter.writeBinary(path, await app.vault.adapter.readBinary(path), {
      mtime: mtime * 1000,
    })
  }
  native.link = async (from: string, to: string) => {
    const identity = await native.stat(from)
    const info = await app.vault.adapter.stat(from.slice('/vault/'.length))
    await link(from, to)
    aliases.set(to, identity.ino)
    const path = to.slice('/vault/'.length)
    await app.vault.adapter.writeBinary(path, await app.vault.adapter.readBinary(path), {
      mtime: info.mtime,
      ctime: info.ctime,
    })
  }
}
destructiveHostCase('preserves a save at the capture boundary (desktop=%s)', async (desktop) => {
  const app = buildFakeVault([])
  await app.vault.adapter.writeBinary('sample.bin', data('sample A').buffer, { mtime: 1000 })
  if (desktop) desktopAdapter(app)
  const disk = new ObsidianFileSystem(app as never)
  const expected = { size: 8, mtime: 1000, sha: await sha256(data('sample A')) }
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  let injected = false
  let saving: Promise<void> | undefined
  app.vault.adapter.rename = async (from, to) => {
    if (from === 'sample.bin' && to.endsWith('/victim')) {
      saving = app.vault.adapter.writeBinary(from, data('sample B').buffer, { mtime: 1000 })
      if (desktop) await saving
      injected = true
    }
    return rename(from, to)
  }
  expect(
    await disk.conditionalFile({ path: 'sample.bin', expected, effect: { kind: 'remove' } })
  ).toBe(!desktop)
  await saving
  expect(injected).toBe(true)
  expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(data('sample B'))
})

destructiveHostCase(
  'applies conditional write, move and removal with retained victims (desktop=%s)',
  async (desktop) => {
    const app = buildFakeVault([])
    if (desktop) desktopAdapter(app)
    const disk = new ObsidianFileSystem(app as never)
    const a = data('sample A'),
      sha = await sha256(a)
    expect(
      await disk.conditionalFile({
        path: 'sample.bin',
        expected: null,
        effect: { kind: 'write', bytes: a, mtime: 1000 },
      })
    ).toBe(true)
    const expected = { size: a.length, sha, mtime: 1000 }
    expect(
      await disk.conditionalFile({
        path: 'sample.bin',
        expected,
        effect: { kind: 'move', to: 'Moved/sample.bin' },
      })
    ).toBe(true)
    expect(await app.vault.adapter.exists('sample.bin')).toBe(false)
    expect(
      await disk.conditionalFile({ path: 'Moved/sample.bin', expected, effect: { kind: 'remove' } })
    ).toBe(true)
    expect(await app.vault.adapter.exists('Moved/sample.bin')).toBe(false)
    await new ObsidianFileSystem(app as never).recoverConditionalFiles()
    expect(await app.vault.adapter.exists('Moved/sample.bin')).toBe(false)
  }
)

destructiveHostCase(
  'restores an interrupted capture into a still-absent public name (desktop=%s)',
  async (desktop) => {
    const app = buildFakeVault([])
    await app.vault.adapter.writeBinary('sample.bin', data('sample A').buffer, { mtime: 1000 })
    if (desktop) desktopAdapter(app)
    const rename = app.vault.adapter.rename.bind(app.vault.adapter),
      stat = app.vault.adapter.stat.bind(app.vault.adapter)
    let crashed = false
    app.vault.adapter.rename = async (from, to) => {
      await rename(from, to)
      if (to.endsWith('/victim')) {
        crashed = true
        throw new Error('power loss')
      }
    }
    app.vault.adapter.stat = async (path) => {
      if (crashed) throw new Error('process stopped')
      return stat(path)
    }
    await expect(
      new ObsidianFileSystem(app as never).conditionalFile({
        path: 'sample.bin',
        expected: { size: 8, sha: await sha256(data('sample A')), mtime: 1000 },
        effect: { kind: 'remove' },
      })
    ).rejects.toThrow()
    app.vault.adapter.rename = rename
    app.vault.adapter.stat = stat
    expect(crashed).toBe(true)
    await new ObsidianFileSystem(app as never).recoverConditionalFiles()
    expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(
      data('sample A')
    )
  }
)

it.each([false, true])(
  'never replaces a destination created during conditional publication (desktop=%s)',
  async (desktop) => {
    const app = buildFakeVault([])
    if (desktop) desktopAdapter(app)
    const disk = new ObsidianFileSystem(app as never)
    const rename = app.vault.adapter.rename.bind(app.vault.adapter)
    const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
    const native = Reflect.get(app.vault.adapter, 'fsPromises')
    const install = desktop ? native.link.bind(native) : rename
    const publish = async (from: string, to: string) => {
      const target = desktop ? to.slice('/vault/'.length) : to
      if (target === 'sample.bin') await write(target, data('sample B').buffer, { mtime: 1000 })
      return install(from, to)
    }
    if (desktop) native.link = publish
    else app.vault.adapter.rename = publish
    expect(
      await disk.conditionalFile({
        path: 'sample.bin',
        expected: null,
        effect: { kind: 'write', bytes: data('sample A'), mtime: 1000 },
      })
    ).toBe(false)
    expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(
      data('sample B')
    )
    if (!desktop) {
      const copies = (await app.vault.adapter.list('')).files.filter(
        (path) => path !== 'sample.bin'
      )
      expect(await Promise.all(copies.map((path) => app.vault.adapter.read(path)))).toContain(
        'sample A'
      )
    }
  }
)

destructiveHostCase(
  'recovers an interrupted capture without overwriting a recreated path (desktop=%s)',
  async (desktop) => {
    const app = buildFakeVault([])
    await app.vault.adapter.writeBinary('sample.bin', data('sample A').buffer, { mtime: 1000 })
    if (desktop) desktopAdapter(app)
    const disk = new ObsidianFileSystem(app as never)
    const rename = app.vault.adapter.rename.bind(app.vault.adapter)
    const stat = app.vault.adapter.stat.bind(app.vault.adapter)
    let crashed = false
    app.vault.adapter.rename = async (from, to) => {
      await rename(from, to)
      if (to.endsWith('/victim')) {
        crashed = true
        throw new Error('power loss')
      }
    }
    app.vault.adapter.stat = async (path) => {
      if (crashed) throw new Error('process stopped')
      return stat(path)
    }
    await expect(
      disk.conditionalFile({
        path: 'sample.bin',
        expected: { size: 8, mtime: 1000, sha: await sha256(data('sample A')) },
        effect: { kind: 'remove' },
      })
    ).rejects.toThrow()
    app.vault.adapter.rename = rename
    app.vault.adapter.stat = stat
    await app.vault.adapter.writeBinary('sample.bin', data('sample B').buffer, { mtime: 1000 })
    await new ObsidianFileSystem(app as never).recoverConditionalFiles()
    expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(
      data('sample B')
    )
    const root = '.obsidian/plugins/abele/sync-conditional'
    expect((await app.vault.adapter.list(root + '/active')).files).toHaveLength(0)
    const objects = await app.vault.adapter.list(root + '/objects')
    const id = objects.folders[0].split('/').at(-1)
    const recovered = 'sample (Conflicted copy restored ' + id + ').bin'
    expect(new Uint8Array(await app.vault.adapter.readBinary(recovered))).toEqual(data('sample A'))
  }
)

it.each([false, true])(
  'installs a sealed opaque stage through the conditional gate (desktop=%s)',
  async (desktop) => {
    const app = buildFakeVault([])
    if (desktop) desktopAdapter(app)
    const disk = new ObsidianFileSystem(app as never),
      bytes = data('sample A')
    const stage = await disk.beginAtomicWrite('sample.bin', 1000, null)
    await stage.append(0, bytes)
    await stage.seal({ size: bytes.length, sha: await sha256(bytes) })
    const evidence = await disk.reopenStage(stage.id)
    await app.vault.adapter.writeBinary('sample.bin', data('sample B').buffer, { mtime: 1000 })
    expect(
      await disk.conditionalFile({
        path: 'sample.bin',
        expected: null,
        effect: { kind: 'install', stageId: stage.id },
      })
    ).toBe(false)
    expect(new Uint8Array(await app.vault.adapter.readBinary(stage.id))).toEqual(bytes)
    await app.vault.adapter.remove('sample.bin')
    expect(
      await disk.conditionalFile({
        path: 'sample.bin',
        expected: null,
        effect: { kind: 'install', stageId: stage.id },
      })
    ).toBe(true)
    expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(bytes)
    if (!desktop) expect(await evidence.installed()).toBe(false)
  }
)

destructiveHostCase(
  'retires an already absent conditional removal without replaying history (desktop=%s)',
  async (desktop) => {
    const app = buildFakeVault([])
    if (desktop) desktopAdapter(app)
    const disk = new ObsidianFileSystem(app as never)
    const expected = { size: 8, mtime: 1000, sha: await sha256(data('sample A')) }
    expect(
      await disk.conditionalFile({ path: 'missing.bin', expected, effect: { kind: 'remove' } })
    ).toBe(true)
    const list = app.vault.adapter.list.bind(app.vault.adapter),
      visited: string[] = []
    app.vault.adapter.list = async (path) => {
      visited.push(path)
      return list(path)
    }
    await new ObsidianFileSystem(app as never).recoverConditionalFiles()
    expect(visited.every((path) => /\/(active|completed|retiring|retained)$/.test(path))).toBe(true)
  }
)
