import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { paragraph, sampleDocx } from '../fixtures/docx/sampleDocx'

let code: string

beforeAll(async () => {
  // Use the real production resolver: the prebundled browser JSZip bypasses scheduler aliases.
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { build } from 'vite'
    const entry = 'virtual:zip-build-test'
    const result = await build({
      configFile: 'vite.config.mts', mode: 'production', logLevel: 'silent',
      plugins: [{
        name: 'zip-build-test',
        resolveId: id => id === entry ? '\\0' + entry : null,
        load: id => id === '\\0' + entry
          ? 'export { default as JSZip } from "jszip"; export { parseAsync } from "docx-preview"'
          : null,
      }],
      build: {
        write: false,
        lib: { entry, formats: ['cjs'], fileName: () => 'zip.js' },
        rollupOptions: { input: entry },
      },
    })
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output)
    process.stdout.write(outputs.find(o => o.type === 'chunk').code)
  `,
    ],
    { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NODE_ENV: 'production' } }
  )
  code = stdout
}, 60_000)

function browserBundle(nativePromise = true, nodeStreams = false, imports = vi.fn()) {
  const module = { exports: {} as any }
  // The mobile loader exposes require but rejects Node imports; no process, Buffer or
  // host immediate APIs. A caught import still produces an Obsidian notice.
  runInNewContext(`const window = globalThis; ${code}`, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Promise: nativePromise ? Promise : undefined,
    DOMParser,
    document,
    Node,
    Uint8Array,
    ArrayBuffer,
    TextEncoder,
    TextDecoder,
    require: (id: string) => {
      imports(id)
      if (id === 'obsidian') return { Platform: { isMobile: !nodeStreams } }
      if (!nodeStreams) throw new Error('Forbidden Node import: ' + id)
      return createRequire(import.meta.url)(id)
    },
    ...(nodeStreams ? { Buffer } : {}),
  })
  return module.exports
}

describe('production ZIP dependency aliases', () => {
  it('does not probe a forbidden Node stream import on mobile', () => {
    const imports = vi.fn()
    browserBundle(true, false, imports)
    expect(imports).not.toHaveBeenCalledWith('stream')
  })
  it.each([true, false])(
    'compresses and reads async ZIP streams (native Promise: %s)',
    async (native) => {
      const { JSZip } = browserBundle(native)
      const zip = new JSZip()
      zip.file('sample.txt', 'Sample stream contents '.repeat(1000))
      const bytes = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        streamFiles: true,
      })
      const reopened = await JSZip.loadAsync(bytes)
      expect(await reopened.file('sample.txt').async('string')).toBe(
        'Sample stream contents '.repeat(1000)
      )
    }
  )

  it('preserves optional Node stream support on desktop', async () => {
    const { JSZip } = browserBundle(true, true)
    const zip = new JSZip()
    zip.file('sample.txt', 'Sample desktop stream')
    const chunks: Buffer[] = []
    for await (const chunk of zip.generateNodeStream({ streamFiles: true })) chunks.push(chunk)
    const reopened = await JSZip.loadAsync(Buffer.concat(chunks))
    expect(await reopened.file('sample.txt').async('string')).toBe('Sample desktop stream')
  })

  it('parses Word packages with the real docx-preview and aliased JSZip', async () => {
    const { parseAsync } = browserBundle()
    const doc = await parseAsync(sampleDocx(paragraph('Sample preview paragraph')))
    const body = JSON.stringify(doc.documentPart.body, (key, value) =>
      key === 'parent' ? undefined : value
    )
    expect(body).toContain('Sample preview paragraph')
  })
})
