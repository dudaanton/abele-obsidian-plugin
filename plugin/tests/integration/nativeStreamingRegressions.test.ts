// @vitest-environment node
import '../helpers/desktopRequire'
import { IDBFactory } from 'fake-indexeddb'
import {
  preservePrivateArtifacts,
  privateRecoveryPath,
  privateArtifactRecovered,
} from '@/sync/privateRecovery'
import { recoverOrphanPrivateArtifacts } from '@/sync/external/pluginSafety'
import { expect, it, vi } from 'vitest'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { App } from 'obsidian'
import { applyStaged, ExpectedWrites, MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { holdTokenDownload } from '@/testing/holdTokenDownload'
import { buildFakeVault } from '../helpers/fakeVault'
import { WriteJournal } from '@/sync/writeJournal'

async function fixture(queued = true) {
  const root = await disk.mkdtemp(join(tmpdir(), 'sample-regression-'))
  const app = buildFakeVault([])
  Object.assign(app.vault.adapter, {
    getFullPath: (path: string) => join(root, path),
    fsPromises: disk,
    queue: queued ? async (work: () => Promise<void>) => work() : undefined,
    exists: async (path: string) =>
      disk.access(join(root, path)).then(
        () => true,
        () => false
      ),
    stat: async (path: string) => {
      try {
        const stat = await disk.stat(join(root, path))
        return {
          type: stat.isFile() ? 'file' : 'folder',
          size: stat.size,
          mtime: stat.mtimeMs,
          ctime: stat.ctimeMs,
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    mkdir: async (path: string) => {
      await disk.mkdir(join(root, path), { recursive: true })
    },
    rename: async (from: string, to: string) => {
      if (
        await disk.access(join(root, to)).then(
          () => true,
          () => false
        )
      )
        throw Object.assign(new Error('destination exists'), { code: 'EEXIST' })
      await disk.rename(join(root, from), join(root, to))
    },
    remove: async (path: string) => disk.unlink(join(root, path)),
    rmdir: async (path: string) => disk.rmdir(join(root, path)),
    list: async (path: string) => {
      const entries = await disk.readdir(join(root, path), { withFileTypes: true })
      return {
        files: entries.filter((entry) => entry.isFile()).map((entry) => path + '/' + entry.name),
        folders: entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => path + '/' + entry.name),
      }
    },
    readBinary: vi.fn(async () => {
      throw new Error('whole-file read')
    }),
  })
  const fs = new ObsidianFileSystem(app as unknown as App)
  return { root, fs, app, close: () => disk.rm(root, { recursive: true, force: true }) }
}

for (const mobile of [false, true])
  it(`keeps streamed stages and displaced files out of user folders (${mobile ? 'adapter' : 'native'})`, async () => {
    const f = await fixture(false)
    try {
      if (mobile)
        Object.assign(f.app.vault.adapter, {
          fsPromises: undefined,
          readBinary: async (path: string) => {
            const bytes = await disk.readFile(join(f.root, path))
            if (bytes.length > 1024 * 1024) throw new Error('unbounded read')
            return Uint8Array.from(bytes).buffer
          },
          writeBinary: async (path: string, bytes: ArrayBuffer) => {
            if (bytes.byteLength > 1024 * 1024) throw new Error('unbounded write')
            await disk.writeFile(join(f.root, path), new Uint8Array(bytes))
          },
          appendBinary: async (path: string, bytes: ArrayBuffer) => {
            if (bytes.byteLength > 1024 * 1024) throw new Error('unbounded append')
            await disk.appendFile(join(f.root, path), new Uint8Array(bytes))
          },
        })
      await disk.mkdir(join(f.root, 'notes'))
      await disk.writeFile(join(f.root, 'notes/sample.bin'), 'original')
      const bytes = new TextEncoder().encode('replacement'),
        sha = await sha256(bytes)
      const stage = await f.fs.beginAtomicWrite(
        'notes/sample.bin',
        2000,
        await f.fs.fingerprint('notes/sample.bin')
      )
      // readdir includes hidden entries; an indexed-file scan misses the regression.
      expect(await disk.readdir(join(f.root, 'notes'))).toEqual(['sample.bin'])
      const observer = new ObsidianFileSystem(f.app as unknown as App)
      const inventory = []
      for await (const file of observer.list()) inventory.push(file.path)
      expect(inventory).not.toContain(stage.id)
      expect((await disk.stat(join(f.root, stage.id))).isFile()).toBe(true)
      await stage.append(0, bytes)
      await stage.seal({ size: bytes.length, sha })
      await stage.commit()
      expect(await disk.readdir(join(f.root, 'notes'))).toEqual(['sample.bin'])
      await f.fs.move('notes/sample.bin', 'moved/sample.bin')
      if (mobile) expect(await disk.readdir(join(f.root, 'notes'))).toEqual([])
      else await expect(disk.stat(join(f.root, 'notes'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await disk.readdir(join(f.root, 'moved'))).toEqual(['sample.bin'])
      expect(await disk.readFile(join(f.root, 'moved/sample.bin'), 'utf8')).toBe('replacement')
    } finally {
      await f.close()
    }
  })

it('streams a peer move and removes its old native file and empty directory', async () => {
  const f = await fixture()
  try {
    const bytes = new TextEncoder().encode('sample'),
      sha = await sha256(bytes)
    await disk.mkdir(join(f.root, 'from'))
    await disk.writeFile(join(f.root, 'from/sample.md'), bytes)
    const oldInfo = (await f.fs.stat('from/sample.md'))!
    const indexed = { path: oldInfo.path, stat: { size: oldInfo.size, mtime: oldInfo.mtime } }
    f.app.vault.getFiles = () => [indexed] as never
    f.app.vault.getFileByPath = (path) => (path === indexed.path ? (indexed as never) : null)
    const replacement = await f.fs.beginAtomicWrite(
      indexed.path,
      2000,
      await f.fs.fingerprint(indexed.path)
    )
    await replacement.append(0, bytes)
    await replacement.seal({ size: bytes.length, sha })
    await replacement.commit()
    // The filesystem publishes before Obsidian asynchronously refreshes its existing index row.
    const listed = []
    for await (const file of f.fs.list()) listed.push(file)
    const info = (await f.fs.stat('from/sample.md'))!
    expect(info.mtime).toBe(2000)
    const state = new MemoryStateStore()
    await state.put({
      ...info,
      wirePath: info.path,
      fileId: 'sample-file',
      versionId: 'sample-before',
      sha,
    })
    const report = await applyStaged(
      {
        getBlob: async () => bytes,
        openVersion: async () => ({
          size: bytes.length,
          read: async (offset: number, length: number) => bytes.slice(offset, offset + length),
          assertUnchanged: async () => {},
          close: async () => {},
        }),
      } as never,
      f.fs,
      state,
      [
        {
          seq: 1,
          file_id: 'sample-file',
          version_id: 'sample-after',
          op: 'move',
          path: 'to/sample.md',
          prev_path: info.path,
          sha,
          size: bytes.length,
          mtime: info.mtime,
          kind: 'note',
          actor: { kind: 'system', id: 'sample', name: 'sample' },
          at: '',
        },
      ] as never,
      {
        dirty: new Set(),
        expected: new ExpectedWrites(),
        filter: { excluded: () => false },
        log: console.debug,
      }
    )
    expect(report.held).toEqual([])
    expect(await f.fs.stat('from/sample.md')).toBeNull()
    const after = []
    for await (const file of f.fs.list()) after.push(file.path)
    expect(after).toEqual(['to/sample.md'])
    expect(await disk.readFile(join(f.root, 'to/sample.md'), 'utf8')).toBe('sample')
    expect(await disk.readdir(join(f.root, 'to'))).toEqual(['sample.md'])
    await expect(disk.stat(join(f.root, 'from'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await f.close()
  }
})

it('recovers an archived native inode when its locator acknowledgement fails', async () => {
  const f = await fixture(false)
  let retained: string | undefined
  try {
    await disk.writeFile(join(f.root, 'sample.bin'), 'original')
    const stage = await f.fs.beginAtomicWrite(
      'sample.bin',
      2000,
      await f.fs.fingerprint('sample.bin')
    )
    const bytes = new TextEncoder().encode('replacement')
    await stage.append(0, bytes)
    await stage.seal({ size: bytes.length, sha: await sha256(bytes) })
    const save = f.app.saveLocalStorage.bind(f.app)
    let fail = true
    f.app.saveLocalStorage = (key, value) => {
      if (
        fail &&
        Array.isArray(value) &&
        value.some((entry) => typeof entry.backup === 'string' && entry.backup.startsWith('/'))
      ) {
        fail = false
        throw new Error('locator acknowledgement lost')
      }
      save(key, value)
    }
    await expect(stage.commit()).rejects.toThrow('neither file was discarded')
    await f.fs.recover()
    const journal = new WriteJournal(f.app)
    retained = journal.recovered()[0].backup
    expect(journal.entries()).toEqual([])
    expect(await disk.readFile(retained, 'utf8')).toBe('original')
    expect(await disk.readdir(f.root)).toEqual(['.obsidian', 'sample.bin'])
    expect(await disk.readdir(join(f.root, '.obsidian/plugins/abele/sync-staging'))).toEqual([])
    expect(await disk.readFile(join(f.root, 'sample.bin'), 'utf8')).toBe('replacement')
  } finally {
    if (retained) await disk.rm(retained, { force: true })
    await f.close()
  }
})

it('archives previously confirmed vault backups even when no publication journal remains', async () => {
  const f = await fixture(false)
  let retained: string | undefined
  try {
    const backup = '.abele-sync-abcd1234.old'
    await disk.writeFile(join(f.root, backup), 'retained original')
    const journal = new WriteJournal(f.app)
    journal.preserve({ target: 'sample.bin', backup })
    await f.fs.recover()
    retained = journal.recovered()[0].backup
    expect(await disk.readdir(f.root)).toEqual([])
    expect(await disk.readFile(retained, 'utf8')).toBe('retained original')
  } finally {
    if (retained && !retained.startsWith('.')) await disk.rm(retained, { force: true })
    await f.close()
  }
})

it('keeps an unfenced displaced inode outside the vault after confirmed native publication', async () => {
  const f = await fixture(false)
  let retained: string | undefined
  let handle: Awaited<ReturnType<typeof disk.open>> | undefined
  try {
    await disk.writeFile(join(f.root, 'sample.bin'), 'original')
    handle = await disk.open(join(f.root, 'sample.bin'), 'r+')
    const stage = await f.fs.beginAtomicWrite(
      'sample.bin',
      2000,
      await f.fs.fingerprint('sample.bin')
    )
    const bytes = new TextEncoder().encode('replacement')
    await stage.append(0, bytes)
    await stage.seal({ size: bytes.length, sha: await sha256(bytes) })
    await stage.commit()
    retained = new WriteJournal(f.app as never).recovered()[0]?.backup
    expect(await disk.readdir(f.root)).toEqual(['.obsidian', 'sample.bin'])
    expect(await disk.readdir(join(f.root, '.obsidian/plugins/abele/sync-staging'))).toEqual([])
    expect(retained).toBeDefined()
    expect(retained!.startsWith(f.root + '/')).toBe(false)
    await handle.write(new TextEncoder().encode('late edit'), 0, 9, 0)
    expect(await disk.readFile(retained!, 'utf8')).toBe('late edit')
    expect(await disk.readFile(join(f.root, 'sample.bin'), 'utf8')).toBe('replacement')
  } finally {
    await handle?.close()
    if (retained && !retained.startsWith(f.root + '/')) await disk.rm(retained, { force: true })
    await f.close()
  }
})

it('holds a native streaming hydration before placement and preserves a concurrent local edit', async () => {
  const f = await fixture()
  const bytes = new TextEncoder().encode('old content'),
    sha = await sha256(bytes)
  const client = {
    versionBytes: async () => bytes,
    openVersion: async () => ({
      size: bytes.length,
      read: async (offset: number, length: number) => bytes.slice(offset, offset + length),
      assertUnchanged: async () => {},
      close: async () => {},
    }),
  }
  const gate = holdTokenDownload({ client } as never, () => {})
  try {
    const stage = await f.fs.beginAtomicWrite('sample.bin', 1000, null)
    const opening = client.openVersion().then(async (source) => {
      const { downloadToStage, TransferBudget } = await import('@abele/sync-sdk/core')
      return downloadToStage(source, stage, { size: bytes.length, sha }, new TransferBudget()).then(
        () => 'installed',
        (error) => error
      )
    })
    expect(await Promise.race([gate.ready.then(() => 'held'), opening.then(() => 'settled')])).toBe(
      'held'
    )
    await disk.writeFile(join(f.root, 'sample.bin'), 'newest local edit')
    gate.release()
    expect(await opening).toBeInstanceOf(Error)
    expect(await disk.readFile(join(f.root, 'sample.bin'), 'utf8')).toBe('newest local edit')
    await stage.discard()
  } finally {
    gate.close()
    await f.close()
  }
})

it('preserves the original inode and late descriptor writes in private recovery', async () => {
  const f = await fixture()
  const app = f.app as unknown as App
  const staging = '.obsidian/plugins/abele/sync-staging/sample-quarantine.bin'
  await disk.mkdir(join(f.root, '.obsidian/plugins/abele/sync-staging'), { recursive: true })
  await disk.writeFile(join(f.root, staging), 'sample projection')
  const handle = await disk.open(join(f.root, staging), 'r+')
  try {
    const before = await handle.stat()
    await preservePrivateArtifacts(app, [staging])
    await handle.write(Buffer.from('sample late edits'), 0, 17, 0)
    await handle.sync()
    await recoverOrphanPrivateArtifacts(app, new IDBFactory())
    const saved = join(f.root, privateRecoveryPath(app, staging)!)
    expect((await disk.stat(saved)).ino).toBe(before.ino)
    expect(await disk.readFile(saved, 'utf8')).toBe('sample late edits')
    expect(await privateArtifactRecovered(app, staging)).toBe(true)
  } finally {
    await handle.close()
    await f.close()
  }
})

it('keeps both recovery copies when a private stage name is reused', async () => {
  const f = await fixture()
  const app = f.app as unknown as App
  const staging = '.obsidian/plugins/abele/sync-staging/sample-reused.bin'
  try {
    await disk.mkdir(join(f.root, '.obsidian/plugins/abele/sync-staging'), { recursive: true })
    await disk.writeFile(join(f.root, staging), 'sample earlier edit')
    await preservePrivateArtifacts(app, [staging])
    await disk.writeFile(join(f.root, staging), 'sample later edit')
    await preservePrivateArtifacts(app, [staging])
    const directory = join(f.root, '.obsidian/plugins/abele/sync-recovery')
    const contents = await Promise.all(
      (await disk.readdir(directory)).map((name) => disk.readFile(join(directory, name), 'utf8'))
    )
    expect(contents.sort()).toEqual(['sample earlier edit', 'sample later edit'])
  } finally {
    await f.close()
  }
})
