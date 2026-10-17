import { describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { DecompressionStream as NodeDecompressionStream } from 'node:stream/web'
import { Gunzip } from 'fflate'
import { ForgejoClient } from '@/forge/forgejoClient'
import { forgejoRepository } from '@/forge/forgejoRepository'
import { deployment } from '@/forge/identity'
import { tarball } from '../e2e/helpers/fakeGithubRepo'
import type { HttpTransport } from '@/forge/transport'

const sha = 'a'.repeat(40)
const base = deployment('forgejo', 'https://forge.example.test/team')
function fixture(size = 50, suppliedArchive?: Uint8Array) {
  const archive =
    suppliedArchive ??
    tarball({ 'src/sample.ts': 'export function sampleThing() {}\n// sampleThing\n' }, 'project')
  const assertCurrent = vi.fn()
  const http = vi.fn<HttpTransport>(async ({ url }) => {
    let json: unknown = null
    let bytes = new ArrayBuffer(0)
    const path = url.slice(base.apiBase.length)
    if (path.endsWith('/commits/main')) json = { sha }
    else if (path.endsWith(`/git/trees/${sha}?recursive=true`))
      json = {
        tree: [{ path: 'src/sample.ts', type: 'blob', mode: '100644', sha: 'b'.repeat(40), size }],
      }
    else if (path.endsWith(`/archive/${sha}.tar.gz`)) bytes = Uint8Array.from(archive).buffer
    else throw new Error('Unexpected fake request')
    return { status: 200, headers: {}, json, text: JSON.stringify(json), arrayBuffer: bytes }
  })
  const source = forgejoRepository(
    new ForgejoClient(base, { connectionId: 'sample', generation: 'one', assertCurrent }, http, ''),
    'sample/project'
  )
  return { source, http, assertCurrent }
}
describe('native exact-revision search', () => {
  it('searches loaded change patches with explicit unavailable diff precision', async () => {
    const { source } = fixture()
    const result = await source.search({
      ref: sha,
      scope: 'changes',
      query: { text: 'sample' },
      glob: '**/*.ts',
      limitBytes: 1024,
      changes: {
        files: [
          {
            path: 'src/sample.ts',
            status: 'modified',
            hash: '',
            additions: 1,
            deletions: 1,
            reviewComments: [],
            patch: '@@ -1 +1 @@\n-old sample\n+new sample\n',
          },
        ],
        lineUrl: () => `${base.webBase}/sample/project/pulls/12/files`,
      },
    })
    expect(result).toMatchObject({
      total: 2,
      note: expect.stringMatching(/precision|precise/i),
      files: [
        {
          path: 'src/sample.ts',
          lines: [
            { label: '1 before', url: `${base.webBase}/sample/project/pulls/12/files` },
            { label: '1', url: `${base.webBase}/sample/project/pulls/12/files` },
          ],
        },
      ],
    })
  })
  it('shares an immutable archive between regex search and heuristic definitions', async () => {
    const { source, http } = fixture()
    const result = await source.search({
      ref: 'main',
      scope: 'repo',
      query: { text: 'sampleThing', regex: true, caseSensitive: true },
      glob: '**/*.ts',
      limitBytes: 1024,
    })
    expect(result).toMatchObject({
      total: 2,
      capped: false,
      files: [
        {
          path: 'src/sample.ts',
          lines: [
            {
              label: '1',
              url: `${base.webBase}/sample/project/src/commit/${sha}/src/sample.ts#L1`,
            },
            {
              label: '2',
              url: `${base.webBase}/sample/project/src/commit/${sha}/src/sample.ts#L2`,
            },
          ],
        },
      ],
    })
    expect(await source.definitions(sha, 'sampleThing', 'src/other.ts', 1024)).toMatchObject([
      { path: 'src/sample.ts', line: 1 },
    ])
    expect(http.mock.calls.filter(([request]) => request.url.includes('/archive/'))).toHaveLength(1)
  })
  it('searches names without an archive and refuses oversized content without a default-branch fallback', async () => {
    const { source, http } = fixture(2048)
    expect(
      await source.search({
        ref: sha,
        scope: 'names',
        query: { text: 'sample' },
        glob: '',
        limitBytes: 1024,
      })
    ).toMatchObject({ files: [{ path: 'src/sample.ts' }] })
    await expect(
      source.search({
        ref: sha,
        scope: 'repo',
        query: { text: 'sample' },
        glob: '',
        limitBytes: 1024,
      })
    ).rejects.toThrow(/limit|too large/i)
    expect(http.mock.calls.some(([request]) => /archive|search\/code/.test(request.url))).toBe(
      false
    )
  })
  it.each(['platform', 'fallback'])(
    'bounds highly compressible archive output during %s decompression',
    async (mode) => {
      const limitBytes = 1024 * 1024
      const unpackedLimit = limitBytes + 2048 + 10240
      const archive = tarball({ 'sample.txt': 'a'.repeat(unpackedLimit + 1) }, 'project')
      expect(archive.byteLength).toBeLessThan(4096)
      const pushes = vi.spyOn(Gunzip.prototype, 'push')
      const allocations: number[] = []
      vi.stubGlobal(
        'Uint8Array',
        new Proxy(Uint8Array, {
          construct(target, args) {
            const result = Reflect.construct(target, args) as Uint8Array
            allocations.push(result.byteLength)
            return result
          },
        })
      )
      const cancel = vi.fn()
      vi.stubGlobal('Blob', NodeBlob)
      vi.stubGlobal(
        'DecompressionStream',
        mode === 'platform'
          ? class {
              constructor() {
                const stream = new NodeDecompressionStream('gzip')
                const getReader = stream.readable.getReader.bind(stream.readable)
                vi.spyOn(stream.readable, 'getReader').mockImplementation(() => {
                  const reader = getReader()
                  const stop = reader.cancel.bind(reader)
                  reader.cancel = (...args) => {
                    cancel()
                    return stop(...args)
                  }
                  return reader
                })
                return stream
              }
            }
          : undefined
      )
      const { source } = fixture(1, archive)
      try {
        await expect(
          source.search({
            ref: sha,
            scope: 'repo',
            query: { text: 'sample' },
            glob: '',
            limitBytes,
          })
        ).rejects.toThrow('The unpacked repository exceeds the search size limit.')
        if (mode === 'platform') expect(cancel).toHaveBeenCalledOnce()
        else {
          expect(pushes).toHaveBeenCalled()
          // Each inflate step has bounded expansion, rather than receiving the entire archive.
          expect(Math.max(...pushes.mock.calls.map(([bytes]) => bytes.length))).toBeLessThanOrEqual(
            32
          )
        }
        expect(allocations.every((size) => size <= unpackedLimit)).toBe(true)
        // Both decoders must still index an ordinary archive after refusing the oversized one.
        const ordinary = fixture()
        expect(
          await ordinary.source.definitions(sha, 'sampleThing', 'src/other.ts', 1024)
        ).toMatchObject([{ path: 'src/sample.ts', line: 1 }])
      } finally {
        pushes.mockRestore()
        vi.unstubAllGlobals()
      }
    }
  )
  it('checks authority even for a previously cached archive', async () => {
    const { source, assertCurrent } = fixture()
    await source.definitions(sha, 'sampleThing', 'src/other.ts', 1024)
    assertCurrent.mockImplementation(() => {
      throw new Error('Retired')
    })
    await expect(source.definitions(sha, 'sampleThing', 'src/other.ts', 1024)).rejects.toThrow(
      'Retired'
    )
  })
})
