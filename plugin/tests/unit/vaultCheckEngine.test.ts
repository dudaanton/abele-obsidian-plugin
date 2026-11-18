import { expect, it, vi } from 'vitest'
import { createVaultCheck } from '@/sync/vaultCheckEngine'

it('retains comparison sizes and the real reason a local read stopped', async () => {
  const { host, source } = fixture()
  await source.run()
  expect(source.state.value).toMatchObject({
    kind: 'differs',
    items: expect.arrayContaining([
      expect.objectContaining({ path: 'different.md', localSize: 5, serverSize: 6 }),
    ]),
  })
  host.fingerprint.mockRejectedValueOnce(new Error('Sample read refused'))
  await source.run()
  expect(source.state.value).toMatchObject({ kind: 'unreachable', reason: 'Sample read refused' })
})

function fixture() {
  const local = new Map([
    ['equal.md', 'same'],
    ['changed.md', 'new'],
    ['different.md', 'local'],
    ['skip.bin', 'skip'],
    ['unknown.md', 'only here'],
  ])
  const host = {
    local: async () =>
      [...local].map(([path, content]) => ({ path, size: content.length, mtime: 1 })),
    remote: async () => ({
      revision: 'one',
      files: [
        { path: 'equal.md', sha: 'same', size: 4 },
        { path: 'changed.md', sha: 'old', size: 3 },
        { path: 'different.md', sha: 'remote', size: 6 },
        { path: 'skip.bin', sha: 'skip', size: 4 },
        { path: 'remote.md', sha: 'there', size: 5 },
      ],
    }),
    revision: async () => 'one',
    fingerprint: vi.fn(async (path: string, _signal: AbortSignal) => ({
      sha: local.get(path)!,
      size: local.get(path)!.length,
    })),
    unchanged: async () => true,
    excluded: (path: string) => path === 'skip.bin',
    pending: async (path: string) => path === 'changed.md',
    send: vi.fn(async (_path: string) => {}),
  }
  return { host, source: createVaultCheck(host) }
}
it('hashes local bytes independently of the ledger and classifies the union without writing', async () => {
  const { host, source } = fixture()
  await source.run()
  expect(source.state.value).toMatchObject({
    kind: 'differs',
    total: 6,
    items: [
      { path: 'changed.md', reason: 'unsent' },
      { path: 'different.md', reason: 'differs' },
      { path: 'skip.bin', reason: 'skipped' },
      { path: 'unknown.md', reason: 'local-only' },
      { path: 'remote.md', reason: 'server-only' },
    ],
  })
  expect(host.fingerprint).toHaveBeenCalledWith('equal.md', expect.any(AbortSignal))
  expect(host.send).not.toHaveBeenCalled()
  await source.send('changed.md')
  expect(host.send).toHaveBeenCalledWith('changed.md')
  await expect(source.send('skip.bin')).rejects.toThrow()
})
it('does not declare equality across a server revision change', async () => {
  const { host, source } = fixture()
  host.revision = async () => 'two'
  await source.run()
  expect(source.state.value.kind).toBe('unreachable')
})
it('keeps a stopped run stopped when a late read resolves, and can restart', async () => {
  const { host, source } = fixture()
  let release!: () => void
  host.fingerprint.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return { sha: 'same', size: 4 }
  })
  const run = source.run()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  source.stop()
  release()
  await run
  expect(source.state.value).toMatchObject({ kind: 'stopped', done: 0 })
  await source.run()
  expect(source.state.value.kind).toBe('differs')
})
it('never reports a file that changed during hashing as matched', async () => {
  const { host, source } = fixture()
  host.unchanged = async () => false
  await source.run()
  expect(source.state.value.kind).toBe('unreachable')
})
it('reports a failed listing without treating partial absence as a result', async () => {
  const { host, source } = fixture()
  host.remote = async () => {
    throw new Error('offline')
  }
  await source.run()
  expect(source.state.value.kind).toBe('unreachable')
})
it('invalidates a result when the inventory revision changes despite identical timestamps', async () => {
  const { host } = fixture()
  let revision = 1
  const fingerprint = host.fingerprint.getMockImplementation()!
  host.fingerprint.mockImplementation(async (...args) => {
    revision++
    return fingerprint(...args)
  })
  const source = createVaultCheck({ ...host, localRevision: () => revision })
  await source.run()
  expect(source.state.value.kind).toBe('unreachable')
})
it('does not resume progress after stop interrupts a pending-file lookup', async () => {
  const { host, source } = fixture()
  let release!: () => void
  host.pending = async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return true
  }
  const run = source.run()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  source.stop()
  release()
  await run
  expect(source.state.value).toMatchObject({ kind: 'stopped', done: 1 })
})
