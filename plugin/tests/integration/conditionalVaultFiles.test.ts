import { expect, it } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

const data = (text: string) => new TextEncoder().encode(text)
function desktopAdapter(app: ReturnType<typeof buildFakeVault>) {
  withDesktopFs(app, { fenced: false })
  // Model hard links' preservation of the source timestamps (the generic fake copies bytes).
  const native = Reflect.get(app.vault.adapter, 'fsPromises')
  const link = native.link.bind(native)
  native.utimes = async (full: string, _atime: number, mtime: number) => {
    const path = full.slice('/vault/'.length)
    await app.vault.adapter.writeBinary(path, await app.vault.adapter.readBinary(path), {
      mtime: mtime * 1000,
    })
  }
  native.link = async (from: string, to: string) => {
    const info = await app.vault.adapter.stat(from.slice('/vault/'.length))
    await link(from, to)
    const path = to.slice('/vault/'.length)
    await app.vault.adapter.writeBinary(path, await app.vault.adapter.readBinary(path), {
      mtime: info.mtime,
      ctime: info.ctime,
    })
  }
}
it.each([false, true])('preserves a save at the capture boundary (desktop=%s)', async (desktop) => {
  const app = buildFakeVault([])
  await app.vault.adapter.writeBinary('sample.bin', data('sample A').buffer, { mtime: 1000 })
  if (desktop) desktopAdapter(app)
  const disk = new ObsidianFileSystem(app as never)
  const expected = { size: 8, mtime: 1000, sha: await sha256(data('sample A')) }
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  let injected = false
  app.vault.adapter.rename = async (from, to) => {
    if (from === 'sample.bin' && to.endsWith('/victim')) {
      await app.vault.adapter.writeBinary(from, data('sample B').buffer, { mtime: 1000 })
      injected = true
    }
    return rename(from, to)
  }
  expect(
    await disk.conditionalFile({ path: 'sample.bin', expected, effect: { kind: 'remove' } })
  ).toBe(false)
  expect(injected).toBe(true)
  expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(data('sample B'))
})

it.each([false, true])(
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

it.each([false, true])(
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
    const native = Reflect.get(app.vault.adapter, 'fsPromises')
    const install = desktop ? native.link.bind(native) : rename
    const publish = async (from: string, to: string) => {
      const target = desktop ? to.slice('/vault/'.length) : to
      if (target === 'sample.bin')
        await app.vault.adapter.writeBinary(target, data('sample B').buffer, { mtime: 1000 })
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
  }
)

it.each([false, true])(
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
    const recovered = 'sample.bin.recovered-' + id
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

it.each([false, true])(
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
    expect(visited.every((path) => path.endsWith('/active'))).toBe(true)
  }
)
