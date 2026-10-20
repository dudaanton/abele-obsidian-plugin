import { describe, expect, it } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { V2Client } from '@/sync/v2/client'

const token = {
  v: 1 as const,
  address: 'https://sync.example',
  key: 'a'.repeat(43),
  scope: { kind: 'folder' as const, id: 'root', path: '/' },
}
describe('token-authorized uploads and content', () => {
  it('always uploads actual bytes, even if the same digest was sent before', async () => {
    const bytes = new TextEncoder().encode('sample'),
      sha = await sha256(bytes)
    const bodies: Uint8Array[] = []
    const client = new V2Client(token, async (url, init) => {
      expect(String(url)).toBe(token.address + '/v2/uploads/' + sha)
      expect(init?.method).toBe('PUT')
      expect(new Headers(init?.headers).get('content-type')).toBe('application/octet-stream')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + token.key)
      bodies.push(new Uint8Array(await new Response(init?.body).arrayBuffer()))
      return Response.json({ sha, size: bytes.length }, { status: 201 })
    })
    await client.putContent(sha, bytes)
    await client.putContent(sha, bytes)
    expect(bodies).toEqual([bytes, bytes])
  })
  it('resumes multipart uploads from received parts and verifies completion', async () => {
    const bytes = new TextEncoder().encode('abcdef'),
      sha = await sha256(bytes)
    const calls: string[] = []
    const client = new V2Client(token, async (url, init) => {
      const path = new URL(String(url)).pathname
      calls.push(path)
      if (path.endsWith('/begin')) {
        expect(JSON.parse(String(init?.body))).toEqual({ size: 6 })
        return Response.json(
          { upload_id: 'upload-a', part_size: 2, parts: 3, received: [0] },
          { status: 201 }
        )
      }
      if (path.endsWith('/complete')) return Response.json({ sha, size: 6 }, { status: 201 })
      expect(init?.method).toBe('PUT')
      const part = Number(path.split('/').at(-1))
      expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(
        bytes.slice(part * 2, part * 2 + 2)
      )
      return new Response(null, { status: 204 })
    })
    await client.putContent(sha, bytes, { simpleUploadBytes: 2 })
    expect(calls.map((path) => path.split('/').at(-1))).toEqual(['begin', '1', '2', 'complete'])
  })
  it('fetches current or exact-version content by file identity and supports HEAD and ranges', async () => {
    const client = new V2Client(token, async (url, init) => {
      expect(new URL(String(url)).pathname).toBe('/v2/files/file-a/content')
      expect(new URL(String(url)).searchParams.get('version_id')).toBe('version/a')
      if (init?.method === 'HEAD')
        return new Response(null, { headers: { 'content-length': '6', 'accept-ranges': 'bytes' } })
      expect(new Headers(init?.headers).get('range')).toBe('bytes=2-3')
      return new Response(new TextEncoder().encode('cd'), {
        status: 206,
        headers: { 'content-range': 'bytes 2-3/6', 'content-length': '2' },
      })
    })
    expect(await client.headContent('file-a', { versionId: 'version/a' })).toEqual({
      size: 6,
      acceptRanges: true,
    })
    expect(
      await client.content('file-a', { versionId: 'version/a', range: { start: 2, end: 3 } })
    ).toEqual(new TextEncoder().encode('cd'))
  })
  it('rejects malformed upload receipts and truncated content', async () => {
    const bytes = new TextEncoder().encode('sample'),
      sha = await sha256(bytes)
    const upload = new V2Client(token, async () =>
      Response.json({ sha, size: 99 }, { status: 201 })
    )
    await expect(upload.putContent(sha, bytes)).rejects.toMatchObject({ code: 'invalid-response' })
    const content = new V2Client(
      token,
      async () => new Response('ab', { status: 206, headers: { 'content-range': 'bytes 0-2/6' } })
    )
    await expect(content.content('file-a', { range: { start: 0, end: 2 } })).rejects.toMatchObject({
      code: 'invalid-response',
    })
  })
  it('does not complete interrupted multipart transfers and maps denied binary calls', async () => {
    const bytes = new TextEncoder().encode('abcdef'),
      sha = await sha256(bytes)
    const calls: string[] = []
    const client = new V2Client(token, async (url) => {
      calls.push(String(url))
      if (String(url).endsWith('/begin'))
        return Response.json({ upload_id: 'upload-a', part_size: 2, parts: 3 })
      throw new Error('lost part response')
    })
    await expect(client.putContent(sha, bytes, { simpleUploadBytes: 2 })).rejects.toMatchObject({
      code: 'unreachable',
    })
    expect(calls.some((url) => url.endsWith('/complete'))).toBe(false)
    const denied = new V2Client(token, async () =>
      Response.json({ error: { code: 'unauthorized' } }, { status: 401 })
    )
    await expect(denied.content('file-a')).rejects.toMatchObject({ code: 'revoked' })
  })
  it('reads current content without a version hint and rejects ignored ranges', async () => {
    const client = new V2Client(token, async (url) => {
      expect(new URL(String(url)).search).toBe('')
      return new Response('sample', { headers: { 'content-length': '6' } })
    })
    expect(new TextDecoder().decode(await client.content('file-a'))).toBe('sample')
    await expect(client.content('file-a', { range: { start: 0, end: 1 } })).rejects.toMatchObject({
      code: 'invalid-response',
    })
  })
  it('fails closed on corrupt multipart plans before sending parts', async () => {
    const bytes = new TextEncoder().encode('abcdef'),
      sha = await sha256(bytes)
    for (const plan of [
      { upload_id: 'upload-a', part_size: 2, parts: 2 },
      { upload_id: 'upload-a', part_size: 2, parts: 3, received: [3] },
      { upload_id: 'upload-a', part_size: 0, parts: 3 },
    ]) {
      let requests = 0
      const client = new V2Client(token, async () => {
        requests++
        return Response.json(plan)
      })
      await expect(client.putContent(sha, bytes, { simpleUploadBytes: 2 })).rejects.toMatchObject({
        code: 'invalid-response',
      })
      expect(requests).toBe(1)
    }
  })
  it('offers explicit multipart continuation with the original upload identity', async () => {
    const bytes = new TextEncoder().encode('abcdef'),
      sha = await sha256(bytes)
    const urls: string[] = []
    const client = new V2Client(token, async (url) => {
      urls.push(String(url))
      return String(url).endsWith('/complete')
        ? Response.json({ sha, size: 6 }, { status: 201 })
        : new Response(null, { status: 204 })
    })
    await client.uploadPart(sha, 'upload-a', 2, bytes.slice(4))
    await client.completeUpload(sha, 'upload-a', 6)
    expect(urls).toEqual([
      token.address + '/v2/uploads/' + sha + '/upload-a/2',
      token.address + '/v2/uploads/' + sha + '/upload-a/complete',
    ])
  })
  it('preserves quota/scope refusals and rejects invalid local hashes without requests', async () => {
    const bytes = new TextEncoder().encode('sample'),
      sha = await sha256(bytes)
    let requests = 0
    const client = new V2Client(token, async () => {
      requests++
      return Response.json({ error: { code: 'quota_exceeded' } }, { status: 413 })
    })
    await expect(client.putContent(sha, bytes)).rejects.toMatchObject({
      code: 'quota_exceeded',
      status: 413,
    })
    await expect(client.putContent('b'.repeat(64), bytes)).rejects.toMatchObject({
      code: 'hash_mismatch',
    })
    expect(requests).toBe(1)
    const updating = new V2Client(token, async () =>
      Response.json({ error: { code: 'scope_updating' } }, { status: 409 })
    )
    await expect(updating.content('file-a')).rejects.toMatchObject({ code: 'scope_updating' })
  })
})
