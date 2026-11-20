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
