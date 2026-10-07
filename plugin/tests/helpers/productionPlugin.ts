import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import { IDBFactory } from 'fake-indexeddb'
import { request as httpRequest } from 'node:http'
import * as obsidian from '../mocks/obsidian'
import { buildFakeVault } from './fakeVault'

/** Electron's native session has no WebView CORS policy and never follows a redirect here. */
const nativeFetch: typeof fetch = async (input, init) => {
  if (init?.redirect !== 'manual')
    throw new Error('Production native transport lost its redirect policy')
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  )
  return new Promise<Response>((resolve, reject) => {
    const req = httpRequest(
      url,
      { method: init?.method, headers: Object.fromEntries(new Headers(init?.headers)) },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          init?.signal?.removeEventListener('abort', abort)
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers: res.headers as Record<string, string>,
            })
          )
        })
        res.on('error', reject)
      }
    )
    const abort = () => req.destroy(new Error('Native request aborted'))
    init?.signal?.addEventListener('abort', abort, { once: true })
    req.on('error', reject)
    if (init?.body) req.write(init.body)
    req.end()
  })
}

/** Evaluate the unmodified single production plugin bundle against a native host stand-in. */
export async function productionPluginCode(): Promise<string> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { build } from 'vite';
    const result = await build({ configFile: 'vite.config.mts', mode: 'production', logLevel: 'silent', build: { write: false } });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output);
    process.stdout.write(outputs.find(o => o.type === 'chunk').code);
  `,
    ],
    { maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NODE_ENV: 'production' } }
  )
  return stdout
}

export async function bootProductionPlugin(code: string) {
  const app = buildFakeVault([]) as any
  const ready: Array<() => void> = []
  Object.assign(app.workspace, {
    onLayoutReady: (fn: () => void) => ready.push(fn),
    getActiveViewOfType: () => null,
    getMostRecentLeaf: () => null,
    getLayout: () => ({ type: 'split', children: [] }),
    getLeavesOfType: () => [],
    iterateAllLeaves: () => {},
  })
  app.plugins = { plugins: {} }
  app.setting = { addSettingTab: () => {} }
  const caches = new Map<string, any>()
  app.metadataCache.getCache = (path: string) =>
    caches.get(path) ?? app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(path))
  const metadata = async (file: any) => {
    if (!file.path.endsWith('.md')) return
    const source = await app.vault.read(file)
    const links: any[] = [],
      embeds: any[] = []
    const start = source.startsWith('---\n') ? source.indexOf('\n---', 4) + 4 : 0
    for (const match of source.slice(start).matchAll(/!?\[\[([^\]]+)\]\]/g)) {
      const offset = start + match.index!
      const item = {
        link: match[1],
        original: match[0],
        position: { start: { offset }, end: { offset: offset + match[0].length } },
      }
      ;(match[0].startsWith('!') ? embeds : links).push(item)
    }
    const cache = { links, embeds }
    caches.set(file.path, cache)
    app.emit('metadataCache', 'changed', file, source, cache)
  }
  for (const verb of ['create', 'modify', 'createBinary', 'modifyBinary', 'process'] as const) {
    const original = app.vault[verb].bind(app.vault)
    app.vault[verb] = async (...args: any[]) => {
      const result = await original(...args)
      const file = verb.startsWith('create') ? result : args[0]
      file.stat.size = (await app.vault.readBinary(file)).byteLength
      file.stat.mtime = Date.now()
      app.emit('vault', verb.startsWith('create') ? 'create' : 'modify', file)
      await metadata(file)
      return result
    }
  }
  if (!(window.indexedDB instanceof IDBFactory))
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() })
  const native = createRequire(import.meta.url)
  const network = { loseScopedCommit: false }
  const sessionFetch: typeof fetch = async (input, init) => {
    const response = await nativeFetch(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (
      network.loseScopedCommit &&
      init?.method === 'POST' &&
      new URL(url).pathname.includes('/scoped/') &&
      new URL(url).pathname.endsWith('/commit') &&
      response.ok
    ) {
      network.loseScopedCommit = false
      throw new Error('Sample successful scoped CREATE response lost')
    }
    return response
  }
  const remote = {
    getCurrentWebContents: () => ({ session: { fetch: sessionFetch } }),
    require: native,
    getGlobal: (name: string) => (globalThis as any)[name],
  }
  const module = { exports: {} as any }
  const evaluate = runInThisContext(`(function(module, exports, require) { ${code}\n})`)
  evaluate(module, module.exports, (id: string) => {
    if (id === 'obsidian') return obsidian
    if (id === '@electron/remote') return remote
    return native(id)
  })
  const Plugin = module.exports.default ?? module.exports
  const plugin = new Plugin()
  const disposals: Array<() => void> = []
  Object.assign(plugin, {
    app,
    manifest: { id: 'abele', version: '1.72.0', dir: '.obsidian/plugins/abele' },
    loadData: async () => null,
    saveData: async () => {},
    addStatusBarItem: () => document.createElement('div'),
    addSettingTab: () => {},
    addCommand: () => {},
    removeCommand: () => {},
    register: (fn: () => void) => disposals.push(fn),
    registerInterval: (id: number) => disposals.push(() => window.clearInterval(id)),
    registerDomEvent: (target: EventTarget, event: string, fn: EventListener, options?: any) => {
      target.addEventListener(event, fn, options)
      disposals.push(() => target.removeEventListener(event, fn, options))
    },
    registerEvent: () => {},
    registerView: () => {},
    registerBasesView: () => {},
    registerExtensions: () => {},
    registerEditorExtension: () => {},
    registerMarkdownPostProcessor: () => {},
    registerMarkdownCodeBlockProcessor: () => {},
    registerObsidianProtocolHandler: () => {},
    addRibbonIcon: () => {},
  })
  await plugin.onload()
  ready.splice(0).forEach((fn) => fn())
  return {
    app,
    plugin,
    metadata,
    network,
    close: async () => {
      const sharing = plugin.syncSharing
      plugin.onunload()
      // The plugin closes this synchronously and records its async work in the reload barrier.
      // Awaiting it here is cleanup observation, never fixture-installed teardown wiring.
      await sharing?.close()
      for (const dispose of disposals.splice(0).reverse()) dispose()
    },
  }
}
