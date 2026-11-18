import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, V2EngineClient } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'

it('restarts with 1249 acknowledged folder echoes without applying or saving them again', async () => {
  const state = new MemoryStateStore()
  const directories = Array.from({ length: 1249 }, (_, n) => ({
    file_id: `folder-${n}`,
    version_id: `version-${n}`,
    path: `section-${n}`,
    kind: 'directory' as const,
    mtime: 1000,
    identity: `identity-${n}`,
  }))
  await state.setMeta('v2-directories', JSON.stringify({ directories, removals: [] }))
  const mkdir = vi.fn()
  const fs = Object.assign(new MemoryFileSystem(), {
    mkdir,
    async *listDirectories() {},
  })
  const save = vi.spyOn(state, 'setMeta')
  const client = new V2EngineClient(
    encodeAccessToken({
      v: 1,
      address: 'https://sync.example',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'root', path: '/' },
    }),
    {
      fetch: async (input) => {
        if (String(input).includes('/connection'))
          return Response.json({
            protocol: 2,
            token_id: 'sample-token',
            space_id: 'sample-space',
            scope: { kind: 'folder', id: 'root', path: '/' },
            status: 'active',
            limits: { max_file_bytes: 1000000, quota_bytes: null },
          })
        return Response.json({
          items: directories.map(({ identity: _identity, ...item }, n) => ({
            type: 'content',
            cursor: n + 1,
            file_id: item.file_id,
            path: item.path,
            prev_path: null,
            item,
            at: '2020-01-01T00:00:00.000Z',
          })),
          cursor: directories.length,
          next: null,
        })
      },
    }
  )
  await client.prepare(fs, state)
  save.mockClear()
  const page = await client.changes(0)
  expect(page.items).toEqual([])
  expect(page.next_since).toBe(1249)
  expect(mkdir).not.toHaveBeenCalled()
  expect(save.mock.calls.filter(([key]) => key === 'v2-directories')).toHaveLength(0)
})
