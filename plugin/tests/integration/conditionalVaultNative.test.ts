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
const recoveryCases = ['blocked', 'present', 'missing'].flatMap((parent) =>
  ['sample.md', 'x'.repeat(248) + '.md', '界'.repeat(80) + '.md', '🙂'.repeat(20) + '.md'].flatMap(
    (name) => [false, true].map((occupied) => ({ parent, name, occupied }))
  )
)
it.each(recoveryCases)(
  'exposes captured bytes as a recognised file: %j',
  async ({ parent, name, occupied }) => {
    const { root, disk } = await setup()
    const path = 'folder/nested/' + name
    await captured(root, 'matrix-record', path)
    if (parent === 'blocked') {
      await fs.writeFile(join(root, 'folder'), 'parent occupant')
      if (occupied && name === 'sample.md')
        await fs.writeFile(
          join(root, 'sample (Conflicted copy restored matrix-record).md'),
          'root occupant'
        )
    } else if (parent !== 'missing' || occupied)
      await fs.mkdir(join(root, 'folder/nested'), { recursive: true })
    if (occupied && parent !== 'blocked') await fs.writeFile(join(root, path), 'public occupant')
    await disk().recoverConditionalFiles()
    const visible: string[] = []
    const walk = async (folder: string) => {
      for (const entry of await fs.readdir(join(root, folder), { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const candidate = folder ? folder + '/' + entry.name : entry.name
        if (entry.isDirectory()) await walk(candidate)
        else if ((await fs.readFile(join(root, candidate), 'utf8')) === 'recovered bytes')
          visible.push(candidate)
      }
    }
    await walk('')
    expect(visible).toHaveLength(1)
    expect(visible[0].endsWith('.md')).toBe(true)
    expect(visible[0]).not.toContain('\uFFFD')
    for (const part of visible[0].split('/'))
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(255)
    if (parent === 'blocked')
      expect(await fs.readFile(join(root, 'folder'), 'utf8')).toBe('parent occupant')
    else if (occupied) expect(await fs.readFile(join(root, path), 'utf8')).toBe('public occupant')
    if (parent === 'blocked' && occupied && name === 'sample.md')
      expect(
        await fs.readFile(join(root, 'sample (Conflicted copy restored matrix-record).md'), 'utf8')
      ).toBe('root occupant')
  }
)
it('recreates a parent removed after capture and recovers following records', async () => {
  let injected = false
  const { root, disk } = await setup({
    rename: async (from: string, to: string) => {
      await fs.rename(from, to)
      if (!injected && from.endsWith('/gone/sample.bin') && to.endsWith('/victim')) {
        injected = true
        await fs.rmdir(join(root, 'gone'))
        throw new Error('capture acknowledgement lost')
      }
    },
  })
  await fs.mkdir(join(root, 'gone'))
  await fs.writeFile(join(root, 'gone/sample.bin'), 'sample A')
  await fs.utimes(join(root, 'gone/sample.bin'), 1, 1)
  await expect(
    disk().conditionalFile({
      path: 'gone/sample.bin',
      expected: { size: 8, mtime: 1000, sha: await sha256(new TextEncoder().encode('sample A')) },
      effect: { kind: 'remove' },
    })
  ).rejects.toThrow()
  await captured(root, 'following', 'following.bin')
  const restarted = await setup({}, root)
  await restarted.disk().recoverConditionalFiles()
  expect(await fs.readFile(join(root, 'gone/sample.bin'), 'utf8')).toBe('sample A')
  expect(await fs.readFile(join(root, 'following.bin'), 'utf8')).toBe('recovered bytes')
})

it('keeps a failed recovery pending while recovering later records', async () => {
  const { root, disk } = await setup({
    link: async (from: string, to: string) => {
      if (from.includes('/a-blocked/'))
        throw Object.assign(new Error('unavailable'), { code: 'EIO' })
      await fs.link(from, to)
    },
  })
  await captured(root, 'a-blocked', 'blocked.bin')
  await captured(root, 'b-following', 'following.bin')
  await expect(disk().recoverConditionalFiles()).rejects.toThrow()
  expect(await fs.readFile(join(root, 'following.bin'), 'utf8')).toBe('recovered bytes')
  expect(await fs.readdir(join(root, '.obsidian/plugins/abele/sync-conditional/active'))).toEqual([
    'a-blocked.json',
  ])
})
async function captured(root: string, id: string, path: string, directory = false) {
  const privateRoot = join(root, '.obsidian/plugins/abele/sync-conditional')
  const folder = join(privateRoot, 'objects', id)
  await fs.mkdir(folder, { recursive: true })
  await fs.mkdir(join(privateRoot, 'active'), { recursive: true })
  await fs.writeFile(join(folder, 'intent.json'), JSON.stringify({ path, kind: 'remove' }))
  await fs.writeFile(join(privateRoot, 'active', id + '.json'), '{}')
  if (directory) {
    await fs.mkdir(join(folder, 'victim'))
    await fs.writeFile(join(folder, 'victim/note.md'), 'recovered notes')
  } else await fs.writeFile(join(folder, 'victim'), 'recovered bytes')
}

it('does not strand directory contents after a crash at reservation creation', async () => {
  let stopped = false
  const { root, disk } = await setup({
    mkdir: async (path, options) => {
      const result = await fs.mkdir(path, options)
      if (!stopped && String(path).endsWith('/directory')) {
        stopped = true
        throw new Error('crash after reservation mkdir')
      }
      return result
    },
  })
  await captured(root, 'directory-record', 'directory', true)
  await disk()
    .recoverConditionalFiles()
    .catch((error) => {
      expect(String(error)).toContain('crash after reservation mkdir')
    })
  await disk().recoverConditionalFiles()
  expect(await fs.readFile(join(root, 'directory/note.md'), 'utf8')).toBe('recovered notes')
})
it('makes a directory swapped at capture visible even when its public name is reused', async () => {
  let injected = false
  const { root, disk } = await setup({
    rename: async (from: string, to: string) => {
      if (!injected && from.endsWith('/sample.bin') && to.endsWith('/victim')) {
        injected = true
        await fs.unlink(from)
        await fs.mkdir(from)
        await fs.writeFile(join(from, 'note.md'), 'swapped notes')
        await fs.rename(from, to)
        await fs.writeFile(from, 'new occupant')
      } else await fs.rename(from, to)
    },
  })
  await fs.writeFile(join(root, 'sample.bin'), 'sample A')
  await fs.utimes(join(root, 'sample.bin'), 1, 1)
  expect(
    await disk().conditionalFile({
      path: 'sample.bin',
      expected: { size: 8, mtime: 1000, sha: await sha256(new TextEncoder().encode('sample A')) },
      effect: { kind: 'remove' },
    })
  ).toBe(false)
  expect(injected).toBe(true)
  const visible = (await fs.readdir(root)).find((name) =>
    name.startsWith('sample (Conflicted copy restored ')
  )
  expect(visible).toBeDefined()
  expect(await fs.readFile(join(root, visible!, 'note.md'), 'utf8')).toBe('swapped notes')
  expect(await fs.readFile(join(root, 'sample.bin'), 'utf8')).toBe('new occupant')
})
it('retains changed victims in legacy completed records during recovery', async () => {
  const { root, disk } = await setup()
  const privateRoot = join(root, '.obsidian/plugins/abele/sync-conditional')
  const folder = join(privateRoot, 'objects/legacy-completed')
  await fs.mkdir(folder, { recursive: true })
  await fs.mkdir(join(privateRoot, 'active'))
  await fs.writeFile(
    join(folder, 'intent.json'),
    JSON.stringify({ path: 'sample.bin', kind: 'remove' })
  )
  await fs.writeFile(join(folder, 'victim'), 'late descriptor edit')
  await fs.writeFile(join(folder, 'complete'), 'true')
  await fs.writeFile(join(privateRoot, 'active/legacy-completed.json'), '{}')
  await disk().recoverConditionalFiles()
  expect(await fs.readFile(join(folder, 'victim'), 'utf8')).toBe('late descriptor edit')
  expect(await fs.readdir(join(privateRoot, 'active'))).toEqual([])
  await expect(fs.stat(join(root, 'sample.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
})
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
      ? join(root, 'a-directory (Conflicted copy restored a-directory)')
      : join(root, 'a-directory')
    expect(await fs.readFile(join(directory, 'note.md'), 'utf8')).toBe('retained note')
    if (occupied) expect(await fs.readFile(join(root, 'a-directory'), 'utf8')).toBe('new occupant')
    expect(await fs.readdir(join(root, privateRoot, 'active'))).toEqual([])
  }
)
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function setup(overrides: Partial<typeof fs> = {}, existingRoot?: string) {
  const root = existingRoot ?? (await fs.mkdtemp(join(tmpdir(), 'sample-conditional-')))
  if (!existingRoot) roots.push(root)
  const app = buildFakeVault([])
  Object.assign(app.vault.adapter, {
    fsPromises: { ...fs, ...overrides },
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
