import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, sha256 } from '@abele/sync-core'
import { encodeAccessToken } from '@abele/sync-protocol'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { PathCoordinator, coordinatedFileSystem } from '@/sync/pathCoordinator'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'

const scope = { kind: 'folder' as const, id: 'root', path: '/' }
const token = (address: string) => encodeAccessToken({ v: 1, address, key: 'a'.repeat(43), scope })
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
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
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
    throw new Error('Unexpected route: ' + route)
  })
  return { fetch, requests, item, bytes, address }
}
function runtime(
  wire: Awaited<ReturnType<typeof server>>,
  fs: MemoryFileSystem,
  state = new MemoryStateStore(),
  locks = new PathCoordinator()
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
      encoded: token(wire.address),
      fs: coordinatedFileSystem(fs, locks),
      state,
      reviews,
      fetch: wire.fetch,
      changed: () => {},
      failed: () => {},
      covers: async () => false,
    }),
    state,
    reviews,
  }
}
it('runs two production token engines through one coordinator with separate ledgers', async () => {
  const fs = new MemoryFileSystem(),
    locks = new PathCoordinator()
  const first = await server('First/first.md', 'first', 'https://first.example', {
      ...scope,
      path: 'First',
    }),
    second = await server('Second/second.md', 'second', 'https://second.example', {
      ...scope,
      path: 'Second',
    })
  // This fixture intentionally tests two independent pulls; ordinary forwarding is tested separately.
  const a = runtime(first, fs, undefined, locks),
    b = runtime(second, fs, undefined, locks)
  try {
    await Promise.all([a.runtime.sync(), b.runtime.sync()])
    expect(new TextDecoder().decode(await fs.read('First/first.md'))).toBe('first')
    expect(new TextDecoder().decode(await fs.read('Second/second.md'))).toBe('second')
    expect(await a.state.getCursor()).toBe(1)
    expect(await b.state.getCursor()).toBe(1)
    expect(first.requests.every((route) => route.startsWith('/v2/'))).toBe(true)
  } finally {
    await Promise.all([a.runtime.disconnect(), b.runtime.disconnect()])
  }
})
it('stages immutable executable bytes before cursor advance and approves without a network fetch', async () => {
  const wire = await server('Scripts/sample.js', 'sample executable'),
    fs = new MemoryFileSystem(),
    a = runtime(wire, fs)
  try {
    await a.runtime.sync()
    expect(await fs.stat('Scripts/sample.js')).toBeNull()
    expect(await a.state.getCursor()).toBe(1)
    const [candidate] = await a.reviews.executables.pending()
    expect(candidate.bytes).toEqual([...wire.bytes])
    const requests = wire.requests.length
    await a.reviews.executables.approve([candidate.id], a.runtime)
    expect(await fs.read(candidate.path)).toEqual(wire.bytes)
    expect((await fs.stat(candidate.path))?.mtime).toBe(1000)
    expect(wire.requests).toHaveLength(requests)
    expect(await a.reviews.executables.pending()).toEqual([])
  } finally {
    await a.runtime.disconnect()
  }
})

it('applies the older reviewed executable candidate while a newer immutable candidate stays pending', async () => {
  const wire = await server('Scripts/sample.js', 'original content'),
    fs = new MemoryFileSystem(),
    a = runtime(wire, fs)
  try {
    await a.runtime.sync()
    const [first] = await a.reviews.executables.pending()
    const nextBytes = new TextEncoder().encode('later candidate!'),
      nextSha = await sha256(nextBytes)
    const newer = {
      ...wire.item,
      version_id: 'later-version',
      sha: nextSha,
      size: nextBytes.length,
      mtime: 2000,
    }
    wire.fetch.mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000000, quota_bytes: null },
        })
      if (url.pathname === '/v2/manifest')
        return Response.json({ items: [newer], cursor: 2, next: null })
      if (url.pathname === '/v2/changes') return Response.json({ items: [], cursor: 2, next: null })
      if (url.pathname.includes('/content')) return new Response(nextBytes)
      throw new Error('Unexpected route')
    })
    await a.runtime.engine.rescan()
    const [original, later] = await a.reviews.executables.pending()
    expect(original.id).toBe(first.id)
    expect(later.bytes).toEqual([...nextBytes])
    wire.fetch.mockRejectedValue(new Error('Approval must use no network'))
    await a.reviews.executables.approve([first.id], a.runtime)
    expect(await fs.read(first.path)).toEqual(wire.bytes)
    expect((await a.reviews.executables.pending()).map((one) => one.id)).toEqual([later.id])
    await a.reviews.executables.approve([later.id], a.runtime)
    expect(await fs.read(first.path)).toEqual(nextBytes)
  } finally {
    await a.runtime.disconnect()
  }
})

it('keeps group exchange closed while the server reports scope_updating', async () => {
  const wire = await server('Shared/sample.md', 'sample'),
    fs = new MemoryFileSystem(),
    a = runtime(wire, fs)
  wire.fetch.mockResolvedValue(
    Response.json({
      protocol: 2,
      token_id: 'sample-token',
      space_id: 'sample-space',
      scope,
      status: 'scope_updating',
      limits: { max_file_bytes: 1000000, quota_bytes: null },
    })
  )
  try {
    await expect(a.runtime.sync()).rejects.toMatchObject({ code: 'scope_updating' })
    expect(fs.snapshot().size).toBe(0)
    expect(await a.state.getCursor()).toBe(0)
  } finally {
    await a.runtime.disconnect()
  }
})

it('refuses a server that mutates an already captured executable version before advancing its cursor', async () => {
  const wire = await server('Scripts/sample.js', 'immutable sample'),
    fs = new MemoryFileSystem(),
    a = runtime(wire, fs)
  try {
    await a.runtime.sync()
    wire.item.sha = 'b'.repeat(64)
    await expect(a.runtime.engine.rescan()).rejects.toThrow(/Immutable executable/)
    expect((await a.reviews.executables.pending())[0].sha).not.toBe(wire.item.sha)
    expect(await fs.stat(wire.item.path)).toBeNull()
  } finally {
    await a.runtime.disconnect()
  }
})

// BUG: DEPENDS: groups. The frozen server/core binding deliberately reports scope_updating.
it.fails('synchronizes a group token once the group binding is available', async () => {
  const wire = await server('Groups/sample.md', 'group sample'),
    fs = new MemoryFileSystem()
  const group = { kind: 'group' as const, id: 'sample-group', path: 'Groups/sample.md' }
  wire.fetch.mockResolvedValue(
    Response.json({
      protocol: 2,
      token_id: 'sample-token',
      space_id: 'sample-space',
      scope: group,
      status: 'scope_updating',
      limits: { max_file_bytes: 1000000, quota_bytes: null },
    })
  )
  const metadata = new MemoryStateStore(),
    runtime = new TokenEngineRuntime({
      id: 'sample-group-connection',
      encoded: encodeAccessToken({
        v: 1,
        address: wire.address,
        key: 'a'.repeat(43),
        scope: group,
      }),
      fs,
      state: new MemoryStateStore(),
      reviews: {
        executables: new ExecutableReview(metadata),
        attachments: new AttachmentConsent(metadata),
        close: () => {},
      },
      fetch: wire.fetch,
      changed: () => {},
      failed: () => {},
      covers: async () => false,
    })
  try {
    await runtime.sync()
    expect(await fs.stat('Groups/sample.md')).not.toBeNull()
  } finally {
    await runtime.disconnect()
  }
})
