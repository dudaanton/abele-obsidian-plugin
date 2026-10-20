import { expect, it, vi } from 'vitest'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { rawManifest } from '../helpers/rawManifest'

it('retains directory identities across raw manifest pages', async () => {
  const folder = {
    file_id: 'sample-folder',
    version_id: 'sample-version',
    path: 'Shared',
    kind: 'directory',
    mtime: 1000,
  }
  const encoded = encodeAccessToken({
    v: 1,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope: { kind: 'folder', id: 'sample-root', path: '/' },
  })
  const transport = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    return Response.json({
      items: url.searchParams.has('next') ? [folder] : [],
      cursor: 1,
      next: url.searchParams.has('next') ? null : 'second-page',
    })
  })
  expect(await rawManifest(encoded, transport)).toEqual([folder])
  expect(transport).toHaveBeenCalledTimes(2)
})
