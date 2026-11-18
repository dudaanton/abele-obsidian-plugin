// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, V2EngineClient } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'

it('keeps an excluded directory when decoding its remote creation', async () => {
  const fixture = boundary()
  await fixture.client.prepare(fixture.fs, fixture.state, () => true)
  await fixture.client.manifest(null)
  expect(fixture.mkdir).not.toHaveBeenCalled()
})

it.each(['delete', 'removal'] as const)(
  'keeps an excluded directory after remote %s and restart',
  async (type) => {
    const fixture = boundary(type)
    await fixture.client.prepare(fixture.fs, fixture.state, () => true)
    await fixture.state.setMeta(
      'v2-directories',
      JSON.stringify({
        schemaVersion: 2,
        incoming: [],
        directories: [{ ...fixture.directory, identity: 'local-folder' }],
        removals: [],
      })
    )
    await fixture.client.changes(1)
    await fixture.client.finishPull()
    expect(fixture.removeDirectory).not.toHaveBeenCalled()
    const restarted = fixture.makeClient()
    await restarted.prepare(fixture.fs, fixture.state, () => true)
    await restarted.finishPull()
    expect(fixture.removeDirectory).not.toHaveBeenCalled()
  }
)

it('retains directory cleanup queued before narrowing, including after restart', async () => {
  const fixture = boundary()
  await fixture.state.setMeta(
    'v2-directories',
    JSON.stringify({
      schemaVersion: 2,
      incoming: [],
      directories: [],
      removals: [{ path: 'Archive', localPath: 'Archive', identity: 'local-folder' }],
    })
  )
  for (let restart = 0; restart < 2; restart++) {
    const client = fixture.makeClient()
    await client.prepare(fixture.fs, fixture.state, () => true)
    await client.finishPull()
  }
  expect(fixture.removeDirectory).not.toHaveBeenCalled()
  expect(JSON.parse((await fixture.state.getMeta('v2-directories'))!).removals).toHaveLength(1)
})

function boundary(type: 'delete' | 'removal' = 'delete') {
  const scope = { kind: 'folder' as const, id: 'root-scope', path: '/' }
  const directory = {
    kind: 'directory' as const,
    file_id: 'sample-folder',
    version_id: 'folder-version',
    path: 'Archive',
    mtime: 1,
  }
  const mkdir = vi.fn(async () => {})
  const removeDirectory = vi.fn(async () => {})
  const fs = Object.assign(new MemoryFileSystem(), {
    mkdir,
    removeDirectory,
    async *listDirectories() {
      yield { path: directory.path, identity: 'local-folder', mtime: 1 }
    },
  })
  const state = new MemoryStateStore()
  const makeClient = () =>
    new V2EngineClient(
      encodeAccessToken({
        v: 1,
        address: 'https://sync.example',
        key: 'a'.repeat(43),
        scope,
      }),
      {
        fetch: async (input) => {
          const path = new URL(String(input)).pathname
          if (path === '/v2/connection')
            return Response.json({
              protocol: 2,
              token_id: 'sample-token',
              space_id: 'sample-space',
              scope,
              status: 'active',
              limits: { max_file_bytes: 1000000, quota_bytes: null },
            })
          if (path === '/v2/manifest')
            return Response.json({ items: [directory], cursor: 1, next: null })
          if (path === '/v2/changes')
            return Response.json({
              items: [
                {
                  type,
                  cursor: 2,
                  file_id: directory.file_id,
                  path: directory.path,
                  ...(type === 'delete' ? { version_id: 'deleted-version' } : {}),
                  at: '2025-01-01T00:00:00.000Z',
                },
              ],
              cursor: 2,
              next: null,
            })
          throw new Error('Unexpected request: ' + path)
        },
      }
    )
  return { client: makeClient(), makeClient, fs, state, directory, mkdir, removeDirectory }
}
