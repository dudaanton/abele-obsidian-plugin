// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

const roots: string[] = []
it('refuses a directory replacing a tracked file before capturing it', async () => {
  const { root, disk } = await setup()
  await fs.mkdir(join(root, 'sample.bin'))
  await fs.writeFile(join(root, 'sample.bin/note.md'), 'sample note')
  expect(
    await disk().conditionalFile({
      path: 'sample.bin',
      expected: { size: 8, mtime: 1000, sha: await sha256(new TextEncoder().encode('sample A')) },
      effect: { kind: 'remove' },
    })
  ).toBe(false)
  expect(await fs.readFile(join(root, 'sample.bin/note.md'), 'utf8')).toBe('sample note')
})

it.each([false, true])(
  'recovers legacy directory captures without blocking later records (occupied=%s)',
  async (occupied) => {
    const { root, disk } = await setup()
    const privateRoot = '.obsidian/plugins/abele/sync-conditional'
    for (const id of ['a-directory', 'b-file']) {
      const folder = join(root, privateRoot, 'objects', id)
      await fs.mkdir(folder, { recursive: true })
      await fs.mkdir(join(root, privateRoot, 'active'), { recursive: true })
      const intent = { path: id, kind: 'remove' }
      await fs.writeFile(join(folder, 'intent.json'), JSON.stringify(intent))
      await fs.writeFile(join(root, privateRoot, 'active', id + '.json'), JSON.stringify(intent))
      if (id === 'a-directory') {
        await fs.mkdir(join(folder, 'victim'))
        await fs.writeFile(join(folder, 'victim/note.md'), 'retained note')
      } else await fs.writeFile(join(folder, 'victim'), 'retained file')
    }
    if (occupied) await fs.writeFile(join(root, 'a-directory'), 'new occupant')
    await disk().recoverConditionalFiles()
    expect(await fs.readFile(join(root, 'b-file'), 'utf8')).toBe('retained file')
    const directory = occupied
      ? join(root, privateRoot, 'objects/a-directory/victim')
      : join(root, 'a-directory')
    expect(await fs.readFile(join(directory, 'note.md'), 'utf8')).toBe('retained note')
    if (occupied) expect(await fs.readFile(join(root, 'a-directory'), 'utf8')).toBe('new occupant')
    expect(await fs.readdir(join(root, privateRoot, 'active'))).toEqual([])
  }
)
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'sample-conditional-'))
  roots.push(root)
  const app = buildFakeVault([])
  Object.assign(app.vault.adapter, {
    fsPromises: fs,
    getFullPath: (path: string) => join(root, path),
    mkdir: async (path: string) => {
      await fs.mkdir(join(root, path), { recursive: true })
    },
    stat: async (path: string) => {
      try {
        const info = await fs.stat(join(root, path))
        return {
          type: info.isFile() ? 'file' : 'folder',
          size: info.size,
          mtime: info.mtimeMs,
          ctime: info.ctimeMs,
        }
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return null
        throw error
      }
    },
    exists: async (path: string) =>
      fs.access(join(root, path)).then(
        () => true,
        () => false
      ),
    list: async (path: string) => {
      const entries = await fs.readdir(join(root, path), { withFileTypes: true })
      return {
        files: entries.filter((one) => one.isFile()).map((one) => path + '/' + one.name),
        folders: entries.filter((one) => one.isDirectory()).map((one) => path + '/' + one.name),
      }
    },
    readBinary: async (path: string) => {
      const bytes = await fs.readFile(join(root, path))
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  })
  desktopFsPort(Reflect.get(app.vault.adapter, 'fsPromises'))
  return { root, app, disk: () => new ObsidianFileSystem(app as never) }
}

it('proves publication by the retained inode, refusing an independent equal-byte replacement', async () => {
  const { root, disk } = await setup(),
    bytes = new TextEncoder().encode('sample bytes')
  const sha = await sha256(bytes)
  expect(
    await disk().conditionalFile({
      path: 'sample.bin',
      expected: null,
      effect: { kind: 'write', bytes, mtime: 1000, receipt: 'sample-receipt' },
    })
  ).toBe(true)
  expect(await disk().installedFile('sample-receipt', 'sample.bin', sha)).toBe(true)
  await fs.writeFile(join(root, 'replacement.bin'), bytes)
  await fs.utimes(join(root, 'replacement.bin'), 1, 1)
  await fs.rename(join(root, 'replacement.bin'), join(root, 'sample.bin'))
  expect(await disk().installedFile('sample-receipt', 'sample.bin', sha)).toBe(false)
  await disk().recoverConditionalFiles()
  expect(await fs.readFile(join(root, 'sample.bin'))).toEqual(Buffer.from(bytes))
})

it('retains a captured inode for saves through a handle opened before removal', async () => {
  const { root, disk } = await setup(),
    path = join(root, 'sample.bin')
  const a = new TextEncoder().encode('sample A'),
    b = new TextEncoder().encode('sample B')
  await fs.writeFile(path, a)
  await fs.utimes(path, 1, 1)
  const handle = await fs.open(path, 'r+')
  try {
    expect(
      await disk().conditionalFile({
        path: 'sample.bin',
        expected: { sha: await sha256(a), size: a.length, mtime: 1000 },
        effect: { kind: 'remove' },
      })
    ).toBe(true)
    await handle.write(b, 0, b.length, 0)
    await handle.sync()
  } finally {
    await handle.close()
  }
  const folder = join(root, '.obsidian/plugins/abele/sync-conditional/objects')
  const ids = await fs.readdir(folder)
  expect(await fs.readFile(join(folder, ids[0], 'victim'))).toEqual(Buffer.from(b))
  await disk().recoverConditionalFiles()
  await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('certifies only a conditionally installed sealed stage and preserves its expected mtime', async () => {
  const { root, disk } = await setup(),
    host = disk()
  const bytes = new TextEncoder().encode('sample bytes'),
    sha = await sha256(bytes)
  await fs.writeFile(join(root, 'sample.bin'), bytes)
  await fs.utimes(join(root, 'sample.bin'), 1, 1)
  const base = { size: bytes.length, sha, mtime: 1000 }
  const stage = await host.beginAtomicWrite('sample.bin', 2000, base)
  await stage.append(0, bytes)
  await stage.seal({ size: bytes.length, sha })
  const reopened = await host.reopenStage(stage.id)
  expect(await reopened.installed()).toBe(false)
  expect(
    await host.conditionalFile({
      path: 'sample.bin',
      expected: base,
      effect: { kind: 'install', stageId: stage.id },
    })
  ).toBe(true)
  expect(await reopened.installed()).toBe(true)
  await fs.writeFile(join(root, 'independent.bin'), bytes)
  await fs.rename(join(root, 'independent.bin'), join(root, 'sample.bin'))
  expect(await reopened.installed()).toBe(false)
})
