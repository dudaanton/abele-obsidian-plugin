import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngineRuntime, type TokenEngineOptions } from '@/sync/tokenEngineRuntime'
import { PathCoordinator, coordinatedFileSystem } from '@/sync/pathCoordinator'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ignoreFor } from '@/sync/scope'
import { deferred } from '../helpers/deferred'

const scope = { kind: 'folder' as const, id: 'root', path: '/' }

it.each(['delayed', 'lost'] as const)(
  '30 preserves an edit owed to a slow connection while a fast reply replaces the shared file (%s response)',
  async (response) => {
    const path = 'Notes/sample.md'
    const fs = new MemoryFileSystem()
    Object.assign(fs, { watch: () => () => {} })
    const locks = new PathCoordinator()
    const slow = await server(path, 'base\n')
    const fast = await server(path, 'base\n', 'https://second.example')
    const owed = new TextEncoder().encode('owed local edit\n')
    const incoming = new TextEncoder().encode('later remote edit\n')
    const owedSha = await sha256(owed),
      incomingSha = await sha256(incoming)
    const slowState = new MemoryStateStore(),
      fastState = new MemoryStateStore()
    const entered = deferred(),
      release = deferred()
    const receipts = new Map<string, object>()
    const committed: string[] = []
    let slowCursor = 1,
      fastCursor = 1,
      remoteChanged = false
    let fastItem = fast.item
    const slowSend = slow.fetch.getMockImplementation()!
    slow.fetch.mockImplementation(async (input, init) => {
      const route = new URL(String(input)).pathname
      if (route === '/v2/changes')
        return Response.json({ items: [], cursor: slowCursor, next: null })
      if (route !== '/v2/commit') return slowSend(input, init)
      const key = new Headers(init?.headers).get('idempotency-key')!
      const existing = receipts.get(key)
      if (existing) return Response.json(existing)
      const { ops } = JSON.parse(String(init?.body))
      const results = ops.map((op: { sha: string; size: number; mtime: number }) => {
        committed.push(op.sha)
        return {
          status: 'applied',
          seq: ++slowCursor,
          ...slow.item,
          version_id: `slow-${slowCursor}`,
          sha: op.sha,
          size: op.size,
          mtime: op.mtime,
        }
      })
      const body = { cursor: slowCursor, results }
      receipts.set(key, body)
      if (receipts.size === 1) {
        entered.resolve()
        await release.promise
        if (response === 'lost') throw new Error('sample response lost after commit')
      }
      return Response.json(body)
    })
    const fastSend = fast.fetch.getMockImplementation()!
    fast.fetch.mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname === '/v2/changes')
        return Response.json({
          items:
            remoteChanged && Number(url.searchParams.get('since')) < fastCursor
              ? [
                  {
                    type: 'content',
                    item: fastItem,
                    file_id: fastItem.file_id,
                    path,
                    cursor: fastCursor,
                    prev_path: null,
                    at: '2025-01-01T00:00:00Z',
                  },
                ]
              : [],
          cursor: fastCursor,
          next: null,
        })
      if (url.pathname.endsWith('/content') && remoteChanged) return new Response(incoming)
      if (url.pathname === '/v2/commit') {
        const { ops } = JSON.parse(String(init?.body))
        return Response.json({
          cursor: ++fastCursor,
          results: ops.map((op: { sha: string; size: number; mtime: number }) => {
            fastItem = {
              ...fastItem,
              version_id: `fast-${fastCursor}`,
              sha: op.sha,
              size: op.size,
              mtime: op.mtime,
            }
            return { status: 'applied', seq: fastCursor, ...fastItem }
          }),
        })
      }
      return fastSend(input, init)
    })
    let one = runtime(slow, fs, slowState, locks),
      other = runtime(fast, fs, fastState, locks)
    let pending = Promise.resolve()
    try {
      await one.runtime.sync()
      await other.runtime.sync()
      await fs.writeAtomic(path, owed, 2000)
      await other.runtime.sync()
      expect((await fastState.get(path))?.sha).toBe(owedSha)
      pending = one.runtime.sync().catch((error: unknown) => {
        if (response !== 'lost') throw error
      })
      await entered.promise
      remoteChanged = true
      fastCursor++
      fastItem = {
        ...fastItem,
        version_id: 'fast-remote',
        sha: incomingSha,
        size: incoming.length,
        mtime: 3000,
      }
      await other.runtime.sync()
      expect(await fs.read(path)).toEqual(incoming)
      expect((await slowState.get(path))?.sha).not.toBe(owedSha)
      release.resolve()
      await pending
      await one.runtime.close()
      await other.runtime.close()
      one = runtime(slow, fs, slowState, locks)
      other = runtime(fast, fs, fastState, locks)
      await one.runtime.sync()
      await other.runtime.sync()
      expect(committed).toEqual([owedSha, incomingSha])
      expect(receipts.size).toBe(2)
      expect((await slowState.get(path))?.sha).toBe(incomingSha)
      expect((await fastState.get(path))?.sha).toBe(incomingSha)
      expect(await fs.read(path)).toEqual(incoming)
      expect(await slowState.getJournal()).toBeNull()
      expect(await fastState.getJournal()).toBeNull()
    } finally {
      release.resolve()
      await pending.catch(() => {})
      await one.runtime.close()
      await other.runtime.close()
    }
  }
)

it.each(['delivered', 'lost'] as const)(
  '52 forwards a confirmed remote delete through another connection without resurrection (%s receipt)',
  async (receipt) => {
    const path = 'Notes/sample.md'
    const first = await server(path, 'saved bytes')
    const second = await server(path, 'saved bytes', 'https://second.example')
    const fs = new MemoryFileSystem(),
      peerFs = new MemoryFileSystem()
    Object.assign(fs, { watch: () => () => {} })
    Object.assign(peerFs, { watch: () => () => {} })
    const locks = new PathCoordinator()
    const firstState = new MemoryStateStore(),
      secondState = new MemoryStateStore(),
      peerState = new MemoryStateStore()
    let remoteDeleted = false,
      secondDeleted = false
    const receipts = new Map<string, object>()
    const deletes: object[] = []
    const event = {
      type: 'delete',
      cursor: 2,
      file_id: first.item.file_id,
      version_id: 'sample-deleted',
      path,
      at: '2025-01-01T00:00:00Z',
    }
    const firstSend = first.fetch.getMockImplementation()!
    first.fetch.mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (remoteDeleted && url.pathname === '/v2/changes')
        return Response.json({
          cursor: 2,
          next: null,
          items: Number(url.searchParams.get('since')) < 2 ? [event] : [],
        })
      if (remoteDeleted && url.pathname === '/v2/manifest')
        return Response.json({ items: [], cursor: 2, next: null })
      return firstSend(input, init)
    })
    const secondSend = second.fetch.getMockImplementation()!
    second.fetch.mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/history')) {
        const base = {
          ...second.item,
          no: 1,
          seq: 1,
          op: 'create',
          actor: { kind: 'key', id: 'sample-token', name: 'Sample' },
          at: '2025-01-01T00:00:00Z',
          merge: null,
        }
        return Response.json(
          secondDeleted
            ? [
                {
                  ...base,
                  no: 2,
                  seq: 2,
                  op: 'delete',
                  version_id: 'sample-deleted',
                  sha: null,
                  size: 0,
                  mtime: 0,
                },
                base,
              ]
            : [base]
        )
      }
      if (secondDeleted && url.pathname === '/v2/changes')
        return Response.json({
          cursor: 2,
          next: null,
          items: Number(url.searchParams.get('since')) < 2 ? [event] : [],
        })
      if (secondDeleted && url.pathname === '/v2/manifest')
        return Response.json({ items: [], cursor: 2, next: null })
      if (url.pathname !== '/v2/commit') return secondSend(input, init)
      const key = new Headers(init?.headers).get('idempotency-key')!
      if (receipts.has(key)) return Response.json(receipts.get(key))
      const { ops } = JSON.parse(String(init?.body))
      expect(ops).toEqual([
        { op: 'delete', file_id: second.item.file_id, base_version_id: second.item.version_id },
      ])
      deletes.push(...ops)
      secondDeleted = true
      const body = {
        cursor: 2,
        results: [
          {
            status: 'applied',
            seq: 2,
            file_id: second.item.file_id,
            version_id: 'sample-deleted',
            path,
            sha: null,
            size: 0,
            mtime: 0,
          },
        ],
      }
      receipts.set(key, body)
      if (receipt === 'lost') throw new Error('sample delete receipt lost')
      return Response.json(body)
    })
    const a = runtime(first, fs, firstState, locks)
    let b = runtime(second, fs, secondState, locks)
    let peer = runtime(second, peerFs, peerState)
    const confirm = async (one: ReturnType<typeof runtime>) => {
      const held = await one.runtime.heldDeletes()
      if (held.length) {
        expect(held).toEqual([{ fileId: first.item.file_id, path }])
        await one.runtime.decideDeletes(
          'confirm',
          held.map((item) => item.fileId)
        )
      }
    }
    try {
      await a.runtime.sync()
      await b.runtime.sync()
      await peer.runtime.sync()
      remoteDeleted = true
      await a.runtime.sync()
      await confirm(a)
      expect(await fs.stat(path)).toBeNull()
      try {
        await b.runtime.sync()
        await confirm(b)
      } catch (error) {
        if (receipt !== 'lost' || !secondDeleted) throw error
      }
      await b.runtime.close()
      b = runtime(second, fs, secondState, locks)
      await b.runtime.sync()
      await confirm(b)
      await peer.runtime.sync()
      await confirm(peer)
      expect(await peerFs.stat(path)).toBeNull()
      await peer.runtime.close()
      peer = runtime(second, peerFs, peerState)
      await b.runtime.sync()
      await peer.runtime.sync()
      expect(deletes).toHaveLength(1)
      expect(receipts.size).toBe(1)
      expect(await fs.stat(path)).toBeNull()
      expect(await peerFs.stat(path)).toBeNull()
      expect(await secondState.get(path)).toBeNull()
      expect(await peerState.get(path)).toBeNull()
      expect(await secondState.getJournal()).toBeNull()
    } finally {
      await a.runtime.close()
      await b.runtime.close()
      await peer.runtime.close()
    }
  }
)

it('50 moves a note between server shares without losing its private destination or reviving the source', async () => {
  await boundaryMove('md')
})

it.each(['bin', 'canvas'])(
  '72 moves a shared %s to a private destination without losing bytes or reviving the shared copy',
  async (extension) => {
    await boundaryMove(extension)
  }
)

it('33 overlapping tokens reuse one file and one publication across restart and disconnect', async () => {
  const path = 'Shared/sample.md'
  const first = await server(path, 'base bytes')
  const overlapScope = { ...scope, id: 'shared-root', path: 'Shared' }
  const second = await server(path, 'base bytes', first.address, overlapScope)
  const fs = new MemoryFileSystem()
  Object.assign(fs, { watch: () => () => {} })
  const locks = new PathCoordinator(),
    firstState = new MemoryStateStore(),
    secondState = new MemoryStateStore()
  let current = first.item,
    bytes = first.bytes,
    cursor = 1,
    downloads = 0
  const commits: object[] = []
  for (const wire of [first, second]) {
    const send = wire.fetch.getMockImplementation()!
    wire.fetch.mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (wire === second && url.pathname === '/v2/connection') {
        const response = await send(input, init)
        return Response.json({ ...(await response.json()), token_id: 'sample-overlapping-token' })
      }
      if (url.pathname === '/v2/manifest')
        return Response.json({ items: [current], cursor, next: null })
      if (url.pathname === '/v2/changes')
        return Response.json({
          cursor,
          next: null,
          items:
            Number(url.searchParams.get('since')) < cursor
              ? [
                  {
                    type: 'content',
                    item: current,
                    file_id: current.file_id,
                    path,
                    cursor,
                    prev_path: null,
                    at: '2025-01-01T00:00:00Z',
                  },
                ]
              : [],
        })
      if (url.pathname.endsWith('/content')) {
        downloads++
        return new Response(bytes)
      }
      if (url.pathname === '/v2/commit') {
        const { ops } = JSON.parse(String(init?.body))
        expect(ops).toEqual([expect.objectContaining({ op: 'modify', file_id: current.file_id })])
        commits.push(...ops)
        const op = ops[0]
        current = {
          ...current,
          sha: op.sha,
          size: op.size,
          mtime: op.mtime,
          version_id: `version-${++cursor}`,
        }
        return Response.json({ cursor, results: [{ status: 'applied', seq: cursor, ...current }] })
      }
      return send(input, init)
    })
  }
  const firstOptions = { id: 'sample-root-connection' }
  const secondOptions = {
    id: 'sample-overlapping-connection',
    encoded: encodeAccessToken({
      v: 1,
      address: second.address,
      key: 'b'.repeat(43),
      scope: overlapScope,
    }),
  }
  let a = runtime(first, fs, firstState, locks, null, firstOptions)
  let b = runtime(second, fs, secondState, locks, null, secondOptions)
  try {
    await a.runtime.sync()
    await b.runtime.sync()
    expect(downloads).toBe(1)
    expect([...fs.snapshot().keys()]).toEqual([path])
    bytes = new TextEncoder().encode('new shared edit')
    await fs.writeAtomic(path, bytes, 2000)
    await a.runtime.sync()
    await b.runtime.sync()
    expect(commits).toHaveLength(1)
    expect((await firstState.get(path))?.sha).toBe(await sha256(bytes))
    expect((await secondState.get(path))?.sha).toBe(await sha256(bytes))
    await a.runtime.close()
    await b.runtime.close()
    a = runtime(first, fs, firstState, locks, null, firstOptions)
    b = runtime(second, fs, secondState, locks, null, secondOptions)
    await a.runtime.sync()
    await b.runtime.sync()
    await b.runtime.disconnect()
    bytes = new TextEncoder().encode('surviving connection edit')
    await fs.writeAtomic(path, bytes, 3000)
    await a.runtime.sync()
    expect(commits).toHaveLength(2)
    expect(downloads).toBe(1)
    expect([...fs.snapshot().keys()]).toEqual([path])
    expect(await fs.read(path)).toEqual(bytes)
    expect((await firstState.get(path))?.sha).toBe(await sha256(bytes))
  } finally {
    await a.runtime.close()
    await b.runtime.close()
  }
})

it('67 reopens a deleted group connection without deleting received members or publishing local edits', async () => {
  const group = { kind: 'group' as const, id: 'sample-group', path: 'Groups/sample.md' }
  const wire = await server(
    group.path,
    'group root',
    'https://group.example',
    group as typeof scope
  )
  wire.item.file_id = group.id
  const bytes = new TextEncoder().encode('---\ngroups: ["[[Groups/sample]]"]\n---\nsaved member')
  const member = {
    ...wire.item,
    file_id: 'member-file',
    version_id: 'member-version',
    path: 'Notes/member.md',
    sha: await sha256(bytes),
    size: bytes.length,
  }
  const send = wire.fetch.getMockImplementation()!
  wire.fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/v2/manifest')
      return Response.json({ items: [wire.item, member], cursor: 1, next: null })
    if (url.pathname === '/v2/files/member-file/content') return new Response(bytes)
    return send(input, init)
  })
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const failed = vi.fn()
  let one = runtime(wire, fs, state, undefined, null, { failed })
  try {
    await one.runtime.sync()
    expect(await fs.read(member.path)).toEqual(bytes)
    await one.runtime.close()
    const local = new TextEncoder().encode('saved local edit after access was closed')
    await fs.writeAtomic(member.path, local, 2000)
    const before = fs.snapshot()
    wire.fetch.mockClear()
    wire.fetch.mockImplementation(async () =>
      Response.json(
        {
          error: { code: 'scope_deleted', message: 'Group no longer available' },
        },
        { status: 401 }
      )
    )
    one = runtime(wire, fs, state, undefined, null, { failed })
    await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'scope_deleted' })
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'scope_deleted' }))
    expect(one.runtime.acceptsLocal(member.path, local.length)).toBe(false)
    await one.runtime.close()
    one = runtime(wire, fs, state, undefined, null, { failed })
    await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'scope_deleted' })
    expect(fs.snapshot()).toEqual(before)
    expect((await state.get(member.path))?.sha).toBe(member.sha)
    expect(wire.fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      '/v2/connection',
      '/v2/connection',
    ])
  } finally {
    await one.runtime.close()
  }
})

it('55 preserves a relocated folder tree while removing only its former shared contents on peers', async () => {
  const first = await server('Shared/Bundle/one.md', 'baseline', 'https://first.example', {
    ...scope,
    id: 'shared-root',
    path: 'Shared',
  })
  const second = await server('Private/Bundle/one.md', '', 'https://second.example', {
    ...scope,
    id: 'private-root',
    path: 'Private',
  })
  const entries = await Promise.all(
    ['one.md', 'Nested/two.md'].map(async (name, i) => {
      const bytes = new TextEncoder().encode(`latest saved ${name}`)
      return {
        bytes,
        initial: {
          ...first.item,
          file_id: `source-${i}`,
          version_id: `source-version-${i}`,
          path: `Shared/Bundle/${name}`,
        },
        target: {
          ...second.item,
          file_id: `destination-${i}`,
          version_id: `destination-version-${i}`,
          path: `Private/Bundle/${name}`,
          sha: await sha256(bytes),
          size: bytes.length,
          mtime: 2000,
        },
      }
    })
  )
  const neighbor = {
    ...first.item,
    file_id: 'neighbor-file',
    version_id: 'neighbor-version',
    path: 'Shared/Neighbor/keep.md',
  }
  const sourceEvents: object[] = [],
    sourceOps: object[] = [],
    destinationOps: object[] = []
  const removed = new Set<string>(),
    published = new Set<string>()
  let sourceCursor = 3,
    destinationCursor = 1
  const firstSend = first.fetch.getMockImplementation()!
  first.fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/v2/manifest')
      return Response.json({
        items: [
          ...entries.map((entry) => entry.initial).filter((item) => !removed.has(item.file_id)),
          neighbor,
        ],
        cursor: sourceCursor,
        next: null,
      })
    if (url.pathname === '/v2/changes')
      return Response.json({
        items: sourceEvents.filter(
          (event) => Reflect.get(event, 'cursor') > Number(url.searchParams.get('since'))
        ),
        cursor: sourceCursor,
        next: null,
      })
    if (url.pathname === '/v2/commit') {
      const { ops } = JSON.parse(String(init?.body))
      const results = ops.map((op: { op: string; file_id: string; base_version_id: string }) => {
        const entry = entries.find((one) => one.initial.file_id === op.file_id)!
        expect(op).toEqual({
          op: 'delete',
          file_id: entry.initial.file_id,
          base_version_id: entry.initial.version_id,
        })
        sourceOps.push(op)
        removed.add(op.file_id)
        const event = {
          type: 'delete',
          file_id: op.file_id,
          version_id: `deleted-${op.file_id}`,
          path: entry.initial.path,
          cursor: ++sourceCursor,
          at: '2025-01-01T00:00:00Z',
        }
        sourceEvents.push(event)
        return {
          status: 'applied',
          seq: event.cursor,
          file_id: op.file_id,
          version_id: event.version_id,
          path: event.path,
          sha: null,
          size: 0,
          mtime: 0,
        }
      })
      return Response.json({ cursor: sourceCursor, results })
    }
    return firstSend(input, init)
  })
  const secondSend = second.fetch.getMockImplementation()!
  second.fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/v2/manifest')
      return Response.json({
        items: entries
          .filter((entry) => published.has(entry.target.path))
          .map((entry) => entry.target),
        cursor: destinationCursor,
        next: null,
      })
    if (url.pathname === '/v2/changes')
      return Response.json({ items: [], cursor: destinationCursor, next: null })
    if (url.pathname.endsWith('/content'))
      return new Response(
        entries.find((entry) => url.pathname.includes('/' + entry.target.file_id + '/'))!.bytes
      )
    if (url.pathname === '/v2/commit') {
      const { ops } = JSON.parse(String(init?.body))
      const results = ops.map((op: { op: string; path: string; sha: string }) => {
        const entry = entries.find((one) => one.target.path === op.path)!
        expect(op).toMatchObject({ op: 'create', path: entry.target.path, sha: entry.target.sha })
        destinationOps.push(op)
        published.add(op.path)
        return { status: 'applied', seq: ++destinationCursor, ...entry.target }
      })
      return Response.json({ cursor: destinationCursor, results })
    }
    return secondSend(input, init)
  })
  const fs = new MemoryFileSystem(),
    peerFs = new MemoryFileSystem(),
    targetFs = new MemoryFileSystem()
  Object.assign(fs, { watch: () => () => {} })
  const locks = new PathCoordinator(),
    sourceState = new MemoryStateStore(),
    targetState = new MemoryStateStore()
  let a = runtime(first, fs, sourceState, locks),
    b = runtime(second, fs, targetState, locks)
  const peer = runtime(first, peerFs),
    targetPeer = runtime(second, targetFs)
  const confirm = async (one: ReturnType<typeof runtime>) => {
    const held = await one.runtime.heldDeletes()
    if (held.length)
      await one.runtime.decideDeletes(
        'confirm',
        held.map((item) => item.fileId)
      )
  }
  try {
    await a.runtime.sync()
    await peer.runtime.sync()
    // Model an external folder relocation on a flat memory disk. No engine runs
    // between its per-file effects; directory identity is covered separately.
    for (const entry of entries) {
      await fs.writeAtomic(entry.initial.path, entry.bytes, 2000)
      await fs.move(entry.initial.path, entry.target.path)
    }
    await a.runtime.sync()
    await confirm(a)
    await b.runtime.sync()
    await peer.runtime.sync()
    await confirm(peer)
    await targetPeer.runtime.sync()
    await a.runtime.close()
    await b.runtime.close()
    a = runtime(first, fs, sourceState, locks)
    b = runtime(second, fs, targetState, locks)
    await a.runtime.sync()
    await b.runtime.sync()
    for (const entry of entries) {
      expect(await fs.stat(entry.initial.path)).toBeNull()
      expect(await peerFs.stat(entry.initial.path)).toBeNull()
      expect(await fs.read(entry.target.path)).toEqual(entry.bytes)
      expect(await targetFs.read(entry.target.path)).toEqual(entry.bytes)
      expect((await targetState.get(entry.target.path))?.sha).toBe(entry.target.sha)
    }
    expect((await Array.fromAsync(peerFs.list())).map((file) => file.path)).toEqual([neighbor.path])
    const retained = [...peerFs.snapshot()].filter(
      ([path]) => path.startsWith('.abele-sync/') && path.endsWith('/victim')
    )
    expect(retained.map(([, bytes]) => bytes)).toEqual([first.bytes, first.bytes])
    expect(new TextDecoder().decode(await fs.read(neighbor.path))).toBe('baseline')
    expect(new TextDecoder().decode(await peerFs.read(neighbor.path))).toBe('baseline')
    expect(sourceOps).toHaveLength(2)
    expect(destinationOps).toHaveLength(2)
    expect(JSON.stringify(sourceOps)).not.toContain('Private/')
    expect(await sourceState.getJournal()).toBeNull()
    expect(await targetState.getJournal()).toBeNull()
  } finally {
    await a.runtime.close()
    await b.runtime.close()
    await peer.runtime.close()
    await targetPeer.runtime.close()
  }
})

it('B8 keeps a quota-blocked conflicting edit visible and recoverable across restart while other files arrive', async () => {
  const wire = await server('Notes/sample.md', 'base line\n')
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const local = new TextEncoder().encode('local conflicting line\n')
  const remote = new TextEncoder().encode('remote conflicting line\n')
  const ordinary = new TextEncoder().encode('unrelated incoming content')
  const remoteItem = {
    ...wire.item,
    version_id: 'remote-version',
    sha: await sha256(remote),
    size: remote.length,
    mtime: 3000,
  }
  const other = {
    ...wire.item,
    file_id: 'other-file',
    version_id: 'other-version',
    path: 'Notes/received.md',
    sha: await sha256(ordinary),
    size: ordinary.length,
  }
  const send = wire.fetch.getMockImplementation()!
  let changed = false
  wire.fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (!changed) return send(input, init)
    if (url.pathname === '/v2/manifest')
      return Response.json({ items: [remoteItem, other], cursor: 3, next: null })
    if (url.pathname === '/v2/changes')
      return Response.json({
        cursor: 3,
        next: null,
        items: [remoteItem, other]
          .map((item, index) => ({
            type: 'content',
            item,
            file_id: item.file_id,
            path: item.path,
            cursor: index + 2,
            prev_path: null,
            at: '2025-01-01T00:00:00Z',
          }))
          .filter((event) => event.cursor > Number(url.searchParams.get('since'))),
      })
    if (url.pathname.endsWith('/content'))
      return new Response(url.pathname.includes('/other-file/') ? ordinary : remote)
    if (url.pathname === '/v2/commit') {
      const { ops } = JSON.parse(String(init?.body))
      expect(ops).toEqual([expect.objectContaining({ sha: await sha256(local) })])
      return Response.json({
        cursor: 3,
        results: ops.map(() => ({
          status: 'rejected',
          code: 'quota_exceeded',
          message: 'no room for conflict copy',
        })),
      })
    }
    return send(input, init)
  })
  let one = runtime(wire, fs, state)
  const verify = async () => {
    const waiting = (await one.runtime.notSynced()).filter((item) => item.kind === 'waiting')
    expect(waiting).toEqual([
      expect.objectContaining({
        direction: 'out',
        fact: wire.item.path + ': no room for conflict copy',
      }),
    ])
    expect(await fs.read(waiting[0].path)).toEqual(local)
    expect(await fs.read(other.path)).toEqual(ordinary)
    expect((await state.get(other.path))?.sha).toBe(other.sha)
    expect(one.runtime.pushRefusalRows()).toEqual([
      expect.objectContaining({ code: 'quota_exceeded' }),
    ])
  }
  try {
    await one.runtime.sync()
    await fs.writeAtomic(wire.item.path, local, 2000)
    changed = true
    await one.runtime.sync()
    await verify()
    await one.runtime.close()
    one = runtime(wire, fs, state)
    await one.runtime.sync()
    await verify()
  } finally {
    await one.runtime.close()
  }
})

async function boundaryMove(extension: string) {
  const from = `Shared/sample.${extension}`,
    to = `Private/sample.${extension}`
  const bytes =
    extension === 'bin'
      ? new Uint8Array([0, 255, 128, 64])
      : new TextEncoder().encode(
          extension === 'canvas' ? '{"nodes":[],"edges":[]}' : 'latest saved bytes'
        )
  const sha = await sha256(bytes)
  const first = await server(from, 'original bytes', 'https://first.example', {
    ...scope,
    id: 'shared-root',
    path: 'Shared',
  })
  const second = await server(to, '', 'https://second.example', {
    ...scope,
    id: 'private-root',
    path: 'Private',
  })
  if (extension !== 'md') {
    first.item.kind = 'attachment'
    second.item.kind = 'attachment'
  }
  const fs = new MemoryFileSystem(),
    sourcePeerFs = new MemoryFileSystem(),
    destinationPeerFs = new MemoryFileSystem()
  Object.assign(fs, { watch: () => () => {} })
  const locks = new PathCoordinator()
  const firstState = new MemoryStateStore(),
    secondState = new MemoryStateStore()
  const sourcePeerState = new MemoryStateStore()
  let removed = false,
    created = false
  const sourceOps: Record<string, unknown>[] = [],
    destinationOps: Record<string, unknown>[] = []
  const sourceEvent = {
    type: 'delete',
    cursor: 2,
    file_id: first.item.file_id,
    version_id: 'source-deleted',
    path: from,
    at: '2025-01-01T00:00:00Z',
  }
  const targetItem = {
    ...second.item,
    file_id: 'destination-file',
    version_id: 'destination-version',
    sha,
    size: bytes.length,
    mtime: 2000,
  }
  const firstSend = first.fetch.getMockImplementation()!
  first.fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/v2/changes')
      return Response.json({
        cursor: removed ? 2 : 1,
        next: null,
        items: removed && Number(url.searchParams.get('since')) < 2 ? [sourceEvent] : [],
      })
    if (url.pathname === '/v2/manifest')
      return Response.json({
        items: removed ? [] : [first.item],
        cursor: removed ? 2 : 1,
        next: null,
      })
    if (url.pathname === '/v2/commit') {
      const { ops } = JSON.parse(String(init?.body))
      expect(ops).toEqual([
        { op: 'delete', file_id: first.item.file_id, base_version_id: first.item.version_id },
      ])
      sourceOps.push(...ops)
      removed = true
      return Response.json({
        cursor: 2,
        results: [
          {
            status: 'applied',
            seq: 2,
            file_id: first.item.file_id,
            version_id: 'source-deleted',
            path: from,
            sha: null,
            size: 0,
            mtime: 0,
          },
        ],
      })
    }
    return firstSend(input, init)
  })
  const secondSend = second.fetch.getMockImplementation()!
  second.fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/v2/manifest')
      return Response.json({
        items: created ? [targetItem] : [],
        cursor: created ? 2 : 1,
        next: null,
      })
    if (url.pathname === '/v2/changes')
      return Response.json({ items: [], cursor: created ? 2 : 1, next: null })
    if (url.pathname.endsWith('/content')) return new Response(bytes)
    if (url.pathname === '/v2/commit') {
      const { ops } = JSON.parse(String(init?.body))
      expect(ops).toEqual([
        expect.objectContaining({ op: 'create', path: to, sha, size: bytes.length }),
      ])
      destinationOps.push(...ops)
      created = true
      return Response.json({ cursor: 2, results: [{ status: 'applied', seq: 2, ...targetItem }] })
    }
    return secondSend(input, init)
  })
  let a = runtime(first, fs, firstState, locks),
    b = runtime(second, fs, secondState, locks)
  const sourcePeer = runtime(first, sourcePeerFs, sourcePeerState)
  const destinationPeer = runtime(second, destinationPeerFs)
  const confirm = async (one: ReturnType<typeof runtime>) => {
    const held = await one.runtime.heldDeletes()
    if (held.length)
      await one.runtime.decideDeletes(
        'confirm',
        held.map((item) => item.fileId)
      )
  }
  try {
    await a.runtime.sync()
    await sourcePeer.runtime.sync()
    await fs.writeAtomic(from, bytes, 2000)
    await fs.writeAtomic('Unrelated/neighbor.md', new TextEncoder().encode('keep'), 1000)
    await fs.move(from, to)
    await a.runtime.sync()
    await confirm(a)
    await b.runtime.sync()
    await sourcePeer.runtime.sync()
    await confirm(sourcePeer)
    await destinationPeer.runtime.sync()
    expect(removed).toBe(true)
    expect(created).toBe(true)
    expect(await sourcePeerFs.stat(from)).toBeNull()
    expect(await destinationPeerFs.read(to)).toEqual(bytes)
    await a.runtime.close()
    await b.runtime.close()
    a = runtime(first, fs, firstState, locks)
    b = runtime(second, fs, secondState, locks)
    await a.runtime.sync()
    await b.runtime.sync()
    expect(await fs.stat(from)).toBeNull()
    expect(await fs.read(to)).toEqual(bytes)
    expect(new TextDecoder().decode(await fs.read('Unrelated/neighbor.md'))).toBe('keep')
    expect(sourceOps).toHaveLength(1)
    expect(JSON.stringify(sourceOps)).not.toContain('Private/')
    expect(destinationOps).toHaveLength(1)
    expect((await secondState.get(to))?.sha).toBe(sha)
    expect(await firstState.get(from)).toBeNull()
  } finally {
    await a.runtime.close()
    await b.runtime.close()
    await sourcePeer.runtime.close()
    await destinationPeer.runtime.close()
  }
}

async function server(
  path: string,
  text: string,
  address = 'https://first.example',
  sharedScope = scope
) {
  const bytes = new TextEncoder().encode(text),
    sha = await sha256(bytes)
  const item = {
    file_id: 'sample-file',
    version_id: 'sample-version',
    path,
    sha,
    size: bytes.length,
    mtime: 1000,
    kind: path.endsWith('.js') ? 'script' : 'note',
  }
  const requests: string[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    ).pathname
    requests.push(route)
    if (route === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'sample-token',
        space_id: 'sample-space',
        scope: sharedScope,
        status: 'active',
        limits: { max_file_bytes: 1000000, quota_bytes: null },
      })
    if (route === '/v2/manifest') return Response.json({ items: [item], cursor: 1, next: null })
    if (route === '/v2/changes') return Response.json({ items: [], cursor: 1, next: null })
    if (route.includes('/content')) return new Response(bytes)
    if (route.startsWith('/v2/uploads/')) return new Response(null, { status: 204 })
    if (route === '/v2/commit') {
      const ops = JSON.parse(String(init?.body)).ops
      return Response.json({
        cursor: 1,
        results: ops.map(() => ({
          status: 'rejected',
          code: 'quota_exceeded',
          message: 'sample quota',
        })),
      })
    }
    throw new Error('Unexpected route: ' + route)
  })
  return { fetch, requests, item, bytes, address, sharedScope, scope: sharedScope }
}
function runtime(
  wire: Awaited<ReturnType<typeof server>>,
  fs: MemoryFileSystem,
  state = new MemoryStateStore(),
  locks = new PathCoordinator(),
  ignoreText: string | null = null,
  progressOptions: Partial<TokenEngineOptions> = {}
) {
  const metadata = new MemoryStateStore()
  const reviews = {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  }
  return {
    runtime: new TokenEngineRuntime({
      id: wire.address,
      encoded: encodeAccessToken({
        v: 1,
        address: wire.address,
        key: 'a'.repeat(43),
        scope: wire.sharedScope,
      }),
      fs: coordinatedFileSystem(fs, locks),
      state,
      reviews,
      fetch: wire.fetch,
      changed: () => {},
      failed: () => {},
      covers: async () => false,
      scopeInput: async () => ({ key: 'sample-scope', ignore: ignoreFor('.obsidian', ignoreText) }),
      ...progressOptions,
    }),
    state,
    reviews,
  }
}
