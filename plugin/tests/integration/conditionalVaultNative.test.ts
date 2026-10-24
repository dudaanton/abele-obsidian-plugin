// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { afterEach, expect, it, vi } from 'vitest'
import { CONDITIONAL_RETENTION_MS, type ConditionalFileHost } from '@/sync/conditionalFiles'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { connectionAdapter, nativeOf } from '@/sync/vaultPathLinks'
import { IDBFactory } from 'fake-indexeddb'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { WriteJournal, JOURNAL_KEY } from '@/sync/writeJournal'
import { deferred } from '../helpers/deferred'

const roots: string[] = []
it('restores a substituted object when identity changes at native capture', async () => {
  const { root, disk } = await setup()
  await fs.writeFile(join(root, 'identity.bin'), 'same bytes')
  await fs.utimes(join(root, 'identity.bin'), 1, 1)
  const host = disk()
  const identity = await host.fileIdentity!('identity.bin')
  const expected = { ...(await host.fingerprint('identity.bin')), identity: identity! }
  let substituted = false
  const port = Reflect.get(Reflect.get(host, 'conditional'), 'host') as ConditionalFileHost
  const leased = port.withMutationCheck!.bind(port)
  const wrap = (owned: ConditionalFileHost): ConditionalFileHost => {
    const capture = owned.capture.bind(owned)
    return {
      ...owned,
      capture: async (from, to) => {
        if (from === 'identity.bin' && !substituted) {
          substituted = true
          await fs.rename(join(root, from), join(root, 'kept.bin'))
          await fs.writeFile(join(root, from), 'same bytes')
          await fs.utimes(join(root, from), 1, 1)
        }
        await capture(from, to)
      },
    }
  }
  Object.assign(port, wrap(port))
  port.withMutationCheck = (check) => wrap(leased(check))
  expect(
    await host.conditionalFile({ path: 'identity.bin', expected, effect: { kind: 'remove' } })
  ).toBe(false)
  expect(substituted).toBe(true)
  expect(await fs.readFile(join(root, 'identity.bin'), 'utf8')).toBe('same bytes')
  expect(await fs.readFile(join(root, 'kept.bin'), 'utf8')).toBe('same bytes')
  expect(await host.fileIdentity!('kept.bin')).toBe(identity)
  expect(await host.fileIdentity!('identity.bin')).not.toBe(identity)
})
it('pairs desktop file identity with the conditional capture authority', async () => {
  const { root, disk } = await setup()
  await fs.writeFile(join(root, 'identity.bin'), 'same bytes')
  const host = disk()
  const identity = await Reflect.get(host, 'fileIdentity')('identity.bin')
  expect(identity).toMatch(/^node-v1:\d+:\d+:\d+$/)
  await fs.rename(join(root, 'identity.bin'), join(root, 'renamed.bin'))
  expect(await Reflect.get(host, 'fileIdentity')('renamed.bin')).toBe(identity)
  await fs.writeFile(join(root, 'identity.bin'), 'same bytes')
  const before = await host.fingerprint('identity.bin')
  expect(
    await host.conditionalFile({
      path: 'identity.bin',
      expected: { ...before, identity },
      effect: { kind: 'remove' },
    } as never)
  ).toBe(false)
  expect(await fs.readFile(join(root, 'identity.bin'), 'utf8')).toBe('same bytes')
  expect(await fs.readFile(join(root, 'renamed.bin'), 'utf8')).toBe('same bytes')
})

it('refuses identity authority when nanosecond birth time is unavailable', async () => {
  const { root, disk } = await setup({
    lstat: (async (...args: Parameters<typeof fs.lstat>) => {
      const stat = await fs.lstat(...args)
      return Object.assign(stat, { birthtimeNs: 0n })
    }) as typeof fs.lstat,
  })
  await fs.writeFile(join(root, 'identity.bin'), 'sample bytes')
  expect(await Reflect.get(disk(), 'fileIdentity')('identity.bin')).toBeNull()
})
it.each(
  ['install', 'public-flush', 'finish-entry', 'alias-remove', 'alias-flush', 'finish-complete']
    .map((boundary) => ({ boundary, committed: false }))
    .concat([{ boundary: 'install', committed: true }])
)(
  'retains anonymous evidence after a native publication crash at $boundary (committed=$committed)',
  async ({ boundary, committed }) => {
    const factory = new IDBFactory(),
      values = new Map<string, unknown>()
    const storage = {
      loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
      saveLocalStorage: (key: string, value: unknown) => {
        values.set(key, structuredClone(value))
      },
    }
    const crash = new Error('simulated process exit')
    let crashed = false
    let publicationPath = ''
    const stop = () => {
      crashed = true
      throw crash
    }
    const { root, app } = await setup({
      link: async (from, to) => {
        await fs.link(from, to)
        if (boundary === 'install' && to === publicationPath) stop()
      },
      unlink: async (path) => {
        await fs.unlink(path)
        if (boundary === 'alias-remove' && String(path).includes('.abele-receipt-')) stop()
      },
    })
    // Native boundaries receive resolved paths even when the temporary root is a link.
    publicationPath = join(await fs.realpath(root), 'sample.bin')
    let host = await HostSyncStorage.open(factory, 'sample-host', storage)
    const state = await IndexedDbStateStore.open(factory, 'sample-ledger')
    try {
      const port = new ObsidianFileSystem(app as never, { storage, ledger: state })
      const writer = Reflect.get(port, 'writer')
      const deps = Reflect.get(writer, 'deps')
      const sync = deps.native.syncPath.bind(deps.native)
      deps.native.syncPath = async (path: string, parentsOnly?: boolean) => {
        await sync(path, parentsOnly)
        if (
          (boundary === 'public-flush' && path === 'sample.bin' && !parentsOnly) ||
          (boundary === 'alias-flush' && path.includes('.abele-receipt-') && parentsOnly)
        )
          stop()
      }
      const finish = Reflect.get(writer, 'finishAnonymous').bind(writer)
      Reflect.set(writer, 'finishAnonymous', async (...args: unknown[]) => {
        if (boundary === 'finish-entry') stop()
        await finish(...args)
        if (boundary === 'finish-complete') stop()
      })
      const bytes = new TextEncoder().encode('sample incoming bytes')
      const row = {
        path: 'sample.bin',
        wirePath: 'sample.bin',
        fileId: 'sample-file',
        versionId: 'sample-version',
        sha: await sha256(bytes),
        size: bytes.length,
        mtime: 1000,
      }
      await expect(port.writeAtomic('sample.bin', bytes, 1000)).rejects.toThrow()
      expect(crashed).toBe(true)
      expect(await new WriteJournal(storage).currentEntries()).toHaveLength(1)
      host.close()
      values.clear()
      const restarted = await setup({}, root)
      host = await HostSyncStorage.open(factory, 'sample-host', storage)
      const recovered = new ObsidianFileSystem(restarted.app as never, { storage, ledger: state })
      if (committed) await state.put(row)
      const changes = vi.spyOn(host, 'changeRecords')
      await recovered.recover()
      expect(await new WriteJournal(storage).currentEntries()).toHaveLength(committed ? 0 : 1)
      await recovered.recover()
      expect(await new WriteJournal(storage).currentEntries()).toHaveLength(committed ? 0 : 1)
      expect(await fs.readFile(join(root, 'sample.bin'))).toEqual(Buffer.from(bytes))
      state.observeCommittedEntries((entries) => recovered.acknowledgeWrites(entries))
      await state.put(row)
      await state.put(row)
      await recovered.recover()
      expect(await new WriteJournal(storage).currentEntries()).toEqual([])
      expect(
        changes.mock.calls
          .flatMap(([batch]) => batch)
          .filter((change) => change.key === JOURNAL_KEY && change.after === undefined)
      ).toHaveLength(1)
      expect(await fs.readFile(join(root, 'sample.bin'))).toEqual(Buffer.from(bytes))
    } finally {
      state.close()
      host.close()
    }
  }
)
it('flushes only dirty directory ancestry without granting ancestor reads to a scoped adapter', async () => {
  const { root, app } = await setup()
  const canonicalRoot = await fs.realpath(root)
  await fs.mkdir(join(canonicalRoot, 'Scoped/nested'), { recursive: true })
  await fs.writeFile(join(root, 'Scoped/nested/sample.md'), 'sample')
  const adapter = connectionAdapter(
    app.vault.adapter as never,
    'Scoped',
    '.abele-sync/connections/sample'
  )
  const opened: string[] = []
  const attributed: string[] = []
  const raw = Reflect.get(app.vault.adapter, 'fsPromises')
  const open = raw.open.bind(raw)
  vi.spyOn(raw, 'open').mockImplementation((path, ...args) => {
    opened.push(String(path))
    return open(path, ...args)
  })
  const port = nativeOf(
    adapter,
    () => {},
    '.abele-sync/connections/sample/recovery',
    (operation, _started, _outcome, paths) => {
      if (operation === 'native open r') attributed.push(...(paths ?? []))
    }
  )!
  await adapter.mkdir('Scoped/nested/created')
  const full = Reflect.get(app.vault.adapter, 'getFullPath').bind(app.vault.adapter)
  const native = Reflect.get(adapter, 'fsPromises')
  await native.link(full('Scoped/nested/sample.md'), full('Scoped/nested/created/linked.md'))
  await port.syncPath!('Scoped/nested/created/linked.md')
  expect(opened).toEqual([
    join(canonicalRoot, 'Scoped/nested/created/linked.md'),
    join(canonicalRoot, 'Scoped/nested/created'),
    join(canonicalRoot, 'Scoped/nested'),
  ])
  expect(attributed).toEqual(Array(3).fill('Scoped/nested/created/linked.md'))
  expect(() =>
    (adapter as unknown as { getFullPath(path: string): string }).getFullPath('')
  ).toThrow('outside this connection')
})
it.each(['active', 'completed'] as const)(
  'does not replay a settled %s restoration after intentional deletion',
  async (state) => {
    const { root, disk } = await setup()
    await captured(root, 'settled-review', 'sample.md')
    if (state === 'completed') {
      const base = join(root, '.obsidian/plugins/abele/sync-conditional')
      await fs.mkdir(join(base, 'completed'))
      await fs.rename(
        join(base, 'active/settled-review.json'),
        join(base, 'completed/settled-review.json')
      )
      await fs.writeFile(join(base, 'objects/settled-review/complete'), '{}')
      await fs.writeFile(
        join(base, 'objects/settled-review/intent.json'),
        JSON.stringify({
          path: 'sample.md',
          kind: 'remove',
          receipt: true,
          expected: { size: 1, mtime: 1000, sha: '0'.repeat(64) },
        })
      )
    }
    await disk().recoverConditionalFiles()
    await fs.unlink(join(root, 'sample.md'))
    const restarted = await setup({}, root)
    await restarted.disk().recoverConditionalFiles()
    expect(await fs.readdir(root)).not.toContain('sample.md')
    expect(
      await fs.readFile(
        join(root, '.obsidian/plugins/abele/sync-conditional/objects/settled-review/victim'),
        'utf8'
      )
    ).toBe('recovered bytes')
  }
)
it.each(['', '{"destination":', 'null', '{"destination":5}'])(
  'recovers after an interrupted restore-plan write (%j)',
  async (partial) => {
    let stopped = false
    const { root, disk } = await setup({
      open: async (path: string, flags: string) => {
        if (stopped) throw new Error('process stopped')
        const handle = await fs.open(path, flags)
        if (path.includes('/restore-plans/') && (await handle.stat()).size === 0) {
          if (partial) await handle.writeFile(partial)
          await handle.close()
          stopped = true
          throw new Error('process stopped after create, before plan population')
        }
        return handle
      },
    })
    await captured(root, 'partial-plan', 'sample.md')
    await expect(disk().recoverConditionalFiles()).rejects.toThrow()
    expect(stopped).toBe(true)
    const plans = join(
      root,
      '.obsidian/plugins/abele/sync-conditional/objects/partial-plan/restore-plans'
    )
    expect(await fs.readFile(join(plans, (await fs.readdir(plans))[0]), 'utf8')).toBe(partial)
    const restarted = await setup({}, root)
    await restarted.disk().recoverConditionalFiles()
    expect(await fs.readFile(join(root, 'sample.md'), 'utf8')).toBe('recovered bytes')
    await assertNoVisibleAliases(root, 'sample.md')
  }
)
it('retains the private victim across a public atomic replacement at private unlink', async () => {
  let replaced = false
  const replace = async (root: string) => {
    await fs.writeFile(join(root, 'replacement.md'), 'new public bytes')
    await fs.rename(join(root, 'replacement.md'), join(root, 'sample.md'))
    replaced = true
  }
  const { root, disk } = await setup({
    unlink: async (path: string) => {
      if (path.endsWith('/victim')) await replace(root)
      await fs.unlink(path)
    },
  })
  await captured(root, 'retain-record', 'sample.md')
  await disk().recoverConditionalFiles()
  if (!replaced) await replace(root)
  expect(await fs.readFile(join(root, 'sample.md'), 'utf8')).toBe('new public bytes')
  expect(
    await fs.readFile(
      join(root, '.obsidian/plugins/abele/sync-conditional/objects/retain-record/victim'),
      'utf8'
    )
  ).toBe('recovered bytes')
})
async function assertNoVisibleAliases(root: string, path: string) {
  const target = await fs.stat(join(root, path))
  const aliases: string[] = []
  const walk = async (folder: string) => {
    for (const entry of await fs.readdir(join(root, folder), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const candidate = folder ? folder + '/' + entry.name : entry.name
      if (entry.isDirectory()) await walk(candidate)
      else {
        const info = await fs.stat(join(root, candidate))
        if (info.dev === target.dev && info.ino === target.ino) aliases.push(candidate)
      }
    }
  }
  await walk('')
  expect(aliases).toEqual([path])
}
it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  'does not publish another name after a post-link flush failure (collision=%s, reservation=%s)',
  async (collision, reserved) => {
    let published = false,
      failed = false
    const { root, disk } = await setup({
      link: async (from: string, to: string) => {
        await fs.link(from, to)
        if (to.endsWith('.md')) published = true
      },
      open: async (path: string, flags: string) => {
        const handle = await fs.open(path, flags)
        const sync = handle.sync.bind(handle)
        handle.sync = async () => {
          if (published && !failed && path.endsWith('.md')) {
            failed = true
            throw new Error('one-shot flush failure after publication')
          }
          await sync()
        }
        return handle
      },
    })
    await fs.mkdir(join(root, 'folder'))
    await fs.writeFile(join(root, 'folder/sample.md'), 'public occupant')
    if (collision)
      await fs.writeFile(
        join(root, 'folder/sample (Conflicted copy restored flush-record).md'),
        'sibling occupant'
      )
    await captured(root, 'flush-record', 'folder/sample.md')
    await expect(disk().recoverConditionalFiles()).rejects.toThrow()
    expect(failed).toBe(true)
    if (reserved) {
      const files = await fs.readdir(join(root, 'folder'))
      let recoveredPath = ''
      for (const name of files)
        if ((await fs.readFile(join(root, 'folder', name), 'utf8')) === 'recovered bytes')
          recoveredPath = 'folder/' + name
      const reservation = disk().externalCoordination.reserve({
        operationId: 'sample-reservation',
        fileId: 'sample-file',
        paths: [recoveredPath],
      })
      try {
        await expect(disk().recoverConditionalFiles()).rejects.toThrow()
        await assertNoVisibleAliases(root, recoveredPath)
      } finally {
        reservation.release()
      }
    }
    await disk().recoverConditionalFiles()
    const names = (await fs.readdir(root)).filter((name) => name.endsWith('.md'))
    expect(names).toEqual([])
    const recovered: string[] = []
    for (const name of await fs.readdir(join(root, 'folder')))
      if ((await fs.readFile(join(root, 'folder', name), 'utf8')) === 'recovered bytes')
        recovered.push(name)
    expect(recovered).toHaveLength(1)
    const sibling = recovered[0]
    await assertNoVisibleAliases(root, 'folder/' + sibling)
  }
)
it.each(['inspect', 'mkdir', 'install'])(
  'falls back visibly after an unexpected %s error',
  async (boundary) => {
    const { root, disk } = await setup({
      lstat: async (path: string) => {
        if (boundary === 'inspect' && path.endsWith('/folder'))
          throw new Error('unexpected inspection failure')
        return fs.lstat(path)
      },
      mkdir: async (path: string, options?: { recursive?: boolean }) => {
        if (boundary === 'mkdir' && path.endsWith('/folder'))
          throw new Error('unexpected mkdir failure')
        return fs.mkdir(path, options)
      },
      link: async (from: string, to: string) => {
        if (boundary === 'install' && to.includes('/folder/'))
          throw new Error('unexpected install failure')
        await fs.link(from, to)
      },
    })
    await captured(root, 'unexpected-record', 'folder/sample.md')
    await disk().recoverConditionalFiles()
    const visible = (await fs.readdir(root)).find(
      (name) => name.startsWith('sample (Conflicted copy restored ') && name.endsWith('.md')
    )
    expect(visible).toBeDefined()
    expect(await fs.readFile(join(root, visible!), 'utf8')).toBe('recovered bytes')
  }
)
const recoveryCases = ['folder/nested', 'Cafe\u0301/nested', 'Café/Cafe\u0301'].flatMap((folder) =>
  ['blocked', 'present', 'missing'].flatMap((parent) =>
    [
      'sample.md',
      'x'.repeat(248) + '.md',
      '界'.repeat(80) + '.md',
      '🙂'.repeat(20) + '.md',
      'Re\u0301sume\u0301.md',
    ].flatMap((name) => [false, true].map((occupied) => ({ folder, parent, name, occupied })))
  )
)
it.each(recoveryCases)(
  'exposes captured bytes as a recognised file: %j',
  async ({ folder, parent, name, occupied }) => {
    const calls = { open: 0, sync: 0, link: 0, rename: 0 }
    const { root, disk } = await setup({
      open: async (path, flags) => {
        calls.open++
        const handle = await fs.open(path, flags)
        const sync = handle.sync.bind(handle)
        handle.sync = async () => {
          calls.sync++
          await sync()
        }
        return handle
      },
      link: async (from, to) => {
        calls.link++
        await fs.link(from, to)
      },
      rename: async (from, to) => {
        calls.rename++
        await fs.rename(from, to)
      },
    })
    const path = folder + '/' + name
    const ancestor = folder.split('/')[0]
    await captured(root, 'matrix-record', path)
    if (parent === 'blocked') {
      await fs.writeFile(join(root, ancestor), 'parent occupant')
      if (occupied && name === 'sample.md')
        await fs.writeFile(
          join(root, 'sample (Conflicted copy restored matrix-record).md'),
          'root occupant'
        )
    } else if (parent !== 'missing' || occupied)
      await fs.mkdir(join(root, folder), { recursive: true })
    if (occupied && parent !== 'blocked') await fs.writeFile(join(root, path), 'public occupant')
    await disk().recoverConditionalFiles()
    // Name length must not turn one recovery into repeated publication or flush work.
    expect(calls.link).toBe(1)
    expect(calls.rename).toBe(1)
    expect(calls.open).toBeLessThanOrEqual(32)
    expect(calls.sync).toBeLessThanOrEqual(32)
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
    await assertNoVisibleAliases(root, visible[0])
    expect(visible[0].endsWith('.md')).toBe(true)
    expect(visible[0]).not.toContain('\uFFFD')
    for (const part of visible[0].split('/'))
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(255)
    if (parent === 'blocked')
      expect(await fs.readFile(join(root, ancestor), 'utf8')).toBe('parent occupant')
    else if (occupied) expect(await fs.readFile(join(root, path), 'utf8')).toBe('public occupant')
    if (parent === 'blocked' && occupied && name === 'sample.md')
      expect(
        await fs.readFile(join(root, 'sample (Conflicted copy restored matrix-record).md'), 'utf8')
      ).toBe('root occupant')
  },
  // Each case flushes real files and ancestors for the restore plan, publication and
  // archived pointer. A busy native volume can exceed the default 5s despite bounded
  // syscall counts; retain the native durability path with scheduling headroom.
  30_000
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
        // Force a lost capture acknowledgement even across the regular-file
        // sentinel's kernel type fence; retain the directory recovery guarantee.
        await fs.unlink(to)
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
// Native durability work can exceed the default 5s on a busy volume.
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
}, 30_000)

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
    writeBinary: async (path: string, bytes: ArrayBuffer, options?: { mtime?: number }) => {
      await fs.writeFile(join(root, path), new Uint8Array(bytes))
      if (options?.mtime !== undefined)
        await fs.utimes(join(root, path), options.mtime / 1000, options.mtime / 1000)
    },
    remove: (path: string) => fs.unlink(join(root, path)),
  })
  desktopFsPort(Reflect.get(app.vault.adapter, 'fsPromises'))
  return { root, app, disk: () => new ObsidianFileSystem(app as never) }
}

// Keep the real flushes and inode checks, with headroom for native I/O scheduling.
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
}, 30_000)

// Native durability work can exceed the default 5s on a busy volume.
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
  const folder = join(root, '.obsidian/plugins/abele/sync-conditional/trash')
  const ids = await fs.readdir(folder)
  expect(await fs.readFile(join(folder, ids[0], 'victim'))).toEqual(Buffer.from(b))
  await disk().recoverConditionalFiles()
  await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + CONDITIONAL_RETENTION_MS + 1000)
  try {
    const restarted = disk()
    await restarted.recoverConditionalFiles()
    for (let i = 0; i < 3; i++) await Reflect.get(restarted, 'conditional').maintenanceStep()
    const recovered = (await fs.readdir(root)).find((name) => name.includes('Recovered copy'))
    expect(recovered).toBeDefined()
    expect(await fs.readFile(join(root, recovered!))).toEqual(Buffer.from(b))
    await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    clock.mockRestore()
  }
}, 30_000)

// Accepted limitation: descriptor held across retention window; final reclamation is final delete.
it('accepted limitation: descriptor held across retention window does not prevent final reclamation', async () => {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  let injected = false
  const { root, disk } = await setup({
    open: async (...args: Parameters<typeof fs.open>) => {
      const file = await fs.open(...args)
      return new Proxy(file, {
        get(target, key) {
          if (key === 'sync') return async () => {}
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
    unlink: async (path) => {
      if (String(path).endsWith('/dying') && !injected) {
        await handle!.write(new TextEncoder().encode('sample B'), 0, 8, 0)
        injected = true
      }
      await fs.unlink(path)
    },
  })
  const path = join(root, 'sample.bin')
  await fs.writeFile(path, 'sample A')
  await fs.utimes(path, 1, 1)
  handle = await fs.open(path, 'r+')
  const conditional = Reflect.get(disk(), 'conditional')
  try {
    await conditional.apply({
      path: 'sample.bin',
      expected: { sha: await sha256(new TextEncoder().encode('sample A')), size: 8, mtime: 1000 },
      effect: { kind: 'remove' },
    })
    Reflect.set(conditional, 'retentionBytes', 1)
    await conditional.maintenanceStep()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 3600000 + 1000)
    try {
      for (let i = 0; i < 3; i++) await conditional.maintenanceStep()
    } finally {
      clock.mockRestore()
    }
    expect(injected).toBe(true)
    const visible = (await fs.readdir(root)).filter((name) => name.includes('Recovered copy'))
    expect(visible).toEqual([])
    expect(await handle.readFile({ encoding: 'utf8' })).toBe('sample B')
    expect((await handle.stat()).nlink).toBe(0)
    expect((await Reflect.get(conditional, 'host').retention.summary()).count).toBe(0)
  } finally {
    await handle.close()
  }
})

it.each(['rename', 'fingerprint', 'lost-rename'] as const)(
  'preserves a descriptor write during retained eviction at %s',
  async (boundary) => {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    let injected = false
    let pauseFlush = false
    let heldFlush = false
    const flushing = deferred(),
      acknowledge = deferred()
    const sync = vi.fn(async () => {
      if (pauseFlush && !heldFlush) {
        heldFlush = true
        flushing.resolve()
        await acknowledge.promise
      }
    })
    const { root, disk } = await setup({
      // This race checks real inode/descriptor behavior, not disk-flush throughput.
      // Keep every flush call, but let the test acknowledge it explicitly.
      open: async (...args: Parameters<typeof fs.open>) => {
        const file = await fs.open(...args)
        return new Proxy(file, {
          get(target, key) {
            if (key === 'sync') return sync
            const value = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
      },
      rename: async (from: string, to: string) => {
        await fs.rename(from, to)
        if ((boundary === 'rename' || boundary === 'lost-rename') && to.endsWith('/dying')) {
          await handle!.write(new TextEncoder().encode('sample B'), 0, 8, 0)
          await handle!.sync()
          await fs.utimes(to, 1, 1)
          injected = true
          if (boundary === 'lost-rename') throw new Error('retirement acknowledgement lost')
        }
      },
    })
    const path = join(root, 'sample.bin')
    await fs.writeFile(path, 'sample A')
    await fs.utimes(path, 1, 1)
    handle = await fs.open(path, 'r+')
    const host = disk(),
      conditional = Reflect.get(host, 'conditional')
    try {
      await host.conditionalFile({
        path: 'sample.bin',
        expected: { sha: await sha256(new TextEncoder().encode('sample A')), size: 8, mtime: 1000 },
        effect: { kind: 'remove' },
      })
      Reflect.set(conditional, 'retentionBytes', 1)
      const port = Reflect.get(conditional, 'host'),
        fingerprint = port.fingerprint.bind(port)
      port.fingerprint = async (path: string) => {
        const value = await fingerprint(path)
        if (boundary === 'fingerprint' && path.endsWith('/dying') && !injected) {
          await handle!.write(new TextEncoder().encode('sample B'), 0, 8, 0)
          await handle!.sync()
          await fs.utimes(join(root, path), 1, 1)
          injected = true
        }
        return value
      }
      await conditional.maintenanceStep()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 3600000 + 1000)
      try {
        if (boundary === 'lost-rename')
          await expect(conditional.maintenanceStep()).rejects.toThrow(
            'retirement acknowledgement lost'
          )
        pauseFlush = true
        let settled = false
        const sweeping = conditional.maintenanceStep().then(() => {
          settled = true
        })
        try {
          await flushing.promise
          expect(settled).toBe(false)
          expect((await port.retention.summary()).count).toBe(1)
          expect(
            (await fs.readdir(root)).filter((name) => name.includes('Recovered copy'))
          ).toEqual([])
        } finally {
          acknowledge.resolve()
          await sweeping
        }
        for (let i = 0; i < 2; i++) await conditional.maintenanceStep()
      } finally {
        clock.mockRestore()
      }
      expect(injected).toBe(true)
      const visible = (await fs.readdir(root)).filter((name) => name.includes('Recovered copy'))
      expect(visible).toHaveLength(1)
      expect(await fs.readFile(join(root, visible[0]), 'utf8')).toBe('sample B')
      expect((await port.retention.summary()).count).toBe(0)
      expect(heldFlush).toBe(true)
      expect(sync).toHaveBeenCalled()
    } finally {
      acknowledge.resolve()
      await handle.close()
    }
  }
)

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
}, 30_000)
