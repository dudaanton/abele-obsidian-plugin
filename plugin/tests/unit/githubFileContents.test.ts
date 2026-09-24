/**
 * A file's contents, whatever the server makes of the media type asked for.
 *
 * An older Enterprise Server does not honour `raw+json` and answers with the contents API's JSON
 * object — the file as base64, or nothing at all past a megabyte. That object must never reach the
 * screen: it is decoded, or the blob it names is read instead. Same for github.com, which is
 * asked the same way.
 */
import { describe, it, expect, vi } from 'vitest'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import { commitSha, loadBlob } from '@/github/api'
import { parseContentsObject } from '@/github/contents'

const TEXT = 'export const greeting = "héllo"\n// ünïcode ✓\n'
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')
/** GitHub wraps its base64 at 60 columns. */
const wrapped = (s: string) => b64(s).replace(/(.{60})/g, '$1\n')

const object = (content: string, encoding = 'base64', size = Buffer.byteLength(TEXT)) => ({
  name: 'a.ts',
  path: 'src/a.ts',
  sha: 'blobsha1',
  size,
  url: 'x',
  html_url: 'x',
  git_url: 'x',
  download_url: 'x',
  type: 'file',
  content,
  encoding,
  _links: {},
})

type Server = 'raw' | 'legacy' | 'large'

/** A server of one kind: honours `raw`, ignores it and sends the object, or has a large file. */
function serve(api: string, kind: Server) {
  const calls: RequestUrlParam[] = []
  const request = vi.fn(async (req: RequestUrlParam): Promise<RequestUrlResponse> => {
    calls.push(req)
    const path = req.url.slice(api.length)
    const accept = String(req.headers?.Accept ?? '')
    const json = (body: unknown): RequestUrlResponse =>
      ({
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        json: body,
        text: JSON.stringify(body),
        arrayBuffer: new TextEncoder().encode(JSON.stringify(body)).buffer,
      }) as RequestUrlResponse
    if (path.startsWith('/repos/o/r/contents/src/a.ts')) {
      if (kind === 'raw' && accept === 'application/vnd.github.raw')
        return {
          status: 200,
          headers: { 'content-type': 'application/vnd.github.raw; charset=utf-8' },
          text: TEXT,
          arrayBuffer: new TextEncoder().encode(TEXT).buffer,
        } as RequestUrlResponse
      if (kind === 'large') return json(object('', 'none', 5_000_000))
      return json(object(wrapped(TEXT)))
    }
    if (path === '/repos/o/r/git/blobs/blobsha1')
      return json({ sha: 'blobsha1', size: 5_000_000, encoding: 'base64', content: wrapped(TEXT) })
    return { status: 404, headers: {}, json: { message: 'Not Found' }, text: '' } as any
  })
  return { request, calls }
}

const SERVERS = [
  { name: 'github.com', server: '', api: 'https://api.github.com' },
  {
    name: 'an Enterprise Server',
    server: 'https://github.corp.example',
    api: 'https://github.corp.example/api/v3',
  },
]

for (const { name, server, api } of SERVERS) {
  describe(`file text from ${name}`, () => {
    const client = (kind: Server) => {
      const s = serve(api, kind)
      return { ...s, client: new GithubClient(endpoints(server), 'tkn', s.request) }
    }

    it('asks for the long-standing raw media type and shows what comes back', async () => {
      const { client: c, calls } = client('raw')
      expect(await c.fileText({ owner: 'o', repo: 'r' }, 'src/a.ts', 'main')).toBe(TEXT)
      expect(calls[0].url).toBe(`${api}/repos/o/r/contents/src/a.ts?ref=main`)
      expect(calls[0].headers?.Accept).toBe('application/vnd.github.raw')
    })

    it('decodes the JSON object a server sends when it ignores the raw type', async () => {
      const { client: c, calls } = client('legacy')
      expect(await c.fileText({ owner: 'o', repo: 'r' }, 'src/a.ts', 'main')).toBe(TEXT)
      expect(calls).toHaveLength(1)
    })

    it('reads a file too large for the object from the git blobs API', async () => {
      const { client: c, calls } = client('large')
      expect(await c.fileText({ owner: 'o', repo: 'r' }, 'src/a.ts', 'main')).toBe(TEXT)
      expect(calls[1].url).toBe(`${api}/repos/o/r/git/blobs/blobsha1`)
      expect(calls[1].headers?.Authorization).toBe('Bearer tkn')
    })

    it('a blob tab shows the file, not the object', async () => {
      for (const kind of ['raw', 'legacy', 'large'] as const) {
        const { client: c } = client(kind)
        const blob = await loadBlob(c, {
          kind: 'blob',
          host: 'github.com',
          owner: 'o',
          repo: 'r',
          rest: ['main', 'src', 'a.ts'],
        })
        expect(blob.text).toBe(TEXT)
      }
    })

    it('bytes: the object is decoded to the file, and a large one comes from its blob', async () => {
      for (const kind of ['raw', 'legacy', 'large'] as const) {
        const { client: c } = client(kind)
        const { bytes } = await c.fileBytes({ owner: 'o', repo: 'r' }, 'src/a.ts', 'main')
        expect(new TextDecoder().decode(bytes)).toBe(TEXT)
      }
    })
  })
}

describe('telling the object from a file', () => {
  it('a JSON file that merely has an "encoding" key is the file', () => {
    expect(parseContentsObject('{"encoding": "utf-8", "content": "x"}')).toBeNull()
    expect(parseContentsObject('[{"type":"file","encoding":"base64"}]')).toBeNull()
    expect(parseContentsObject('plain text')).toBeNull()
    expect(parseContentsObject(JSON.stringify(object('eA==')))).not.toBeNull()
  })
})

describe('the sha media type', () => {
  const answering = (text: string) =>
    new GithubClient(
      endpoints('https://github.corp.example'),
      '',
      async () =>
        ({ status: 200, headers: {}, text, json: null, arrayBuffer: new ArrayBuffer(0) }) as any
    )
  const SHA = 'a'.repeat(40)

  it('takes the bare SHA', async () => {
    expect(await commitSha(answering(`${SHA}\n`), { owner: 'o', repo: 'r' }, 'main')).toBe(SHA)
  })

  it('takes the sha out of a whole commit from a server that ignored the type', async () => {
    const commit = JSON.stringify({ sha: SHA, commit: { message: 'x' } })
    expect(await commitSha(answering(commit), { owner: 'o', repo: 'r' }, 'main')).toBe(SHA)
  })
})
