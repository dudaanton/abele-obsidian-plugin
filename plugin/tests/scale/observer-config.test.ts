// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, copyFile, readFile, rm, stat } from 'node:fs/promises'
import * as fs from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { qualificationScenario, qualificationInstrumentation } from './qualification-config.mjs'
import { observerDeploymentConfig } from './observer-config.mjs'

const modules = {
  interruptionBoundary: 'interruption-boundary.cjs',
  hostEntries: 'host-entries.cjs',
  evidenceWriter: 'evidence-writer.cjs',
  heapProbe: 'heap.cjs',
  controlError: 'control-error.cjs',
  failureDiagnostic: 'failure-diagnostic.cjs',
  writeObserver: 'writes.cjs',
  reindexObserver: 'reindex.cjs',
  diagnostics: 'diagnostics.cjs',
  entryLedger: 'entry-ledger.cjs',
  liveStartup: 'live-startup.cjs',
  receiptCapture: 'receipt-capture.cjs',
  fingerprintObserver: 'failure-diagnostic.cjs',
  profileGate: 'profile-gate.cjs',
  profileOnly: 'profile-only.cjs',
  metadataCache: 'metadata-cache.cjs',
  indexWaitCapture: 'index-wait-capture.cjs',
}

it('renderer-loaded harness modules never require a relative local specifier', async () => {
  const files = new Set([
    'observer.cjs',
    ...Object.values(modules),
    'host-entries.cjs',
    'diag-capture.cjs',
    'indexeddb.cjs',
  ])
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    expect(source, file).not.toMatch(/\brequire\s*\(\s*['"]\.{1,2}\//)
  }
})

async function deployed(mode: string, check: (config: any, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'observer-config-'))
  try {
    const observer = join(root, '.obsidian/plugins/scale-observer')
    await mkdir(observer, { recursive: true })
    for (const name of new Set(['observer.cjs', ...Object.values(modules)]))
      await copyFile(new URL(name, import.meta.url), join(observer, name))
    const config = observerDeploymentConfig(
      qualificationScenario(mode, { output: root }),
      observer,
      '0',
      'function durableHostOf() {}\nfunction storageOf() {}\nclass BoundedVaultIo {}\nmarkLoad("evalEnd");\n'
    )
    await check(config, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

it.each(['targeted', 'full'])(
  '%s deployment keeps module paths separate from boolean policy',
  async (mode) => {
    await deployed(mode, async (config) => {
      for (const [key, name] of Object.entries(modules)) {
        expect(typeof config[key], key).toBe('string')
        expect(isAbsolute(config[key]), key).toBe(true)
        expect(config[key].endsWith('/' + name)).toBe(true)
        expect((await stat(config[key])).isFile()).toBe(true)
      }
      for (const key of Object.keys(qualificationInstrumentation))
        expect(typeof config[key], key).toBe('boolean')
    })
  }
)

it.each(['targeted', 'full'])(
  '%s actual observer loads deployed helpers with relative specifiers refused',
  async (mode) => {
    await deployed(mode, async (config, root) => {
      let reached = false,
        loadedBoundary = false,
        failure: unknown
      const controlledEnd = new Error('Controlled post-helper boundary')
      const nativeRequire = createRequire(import.meta.url)
      const diagnostic = {
        openEvidencePort: () => 'sample-channel',
        watch: () => {
          reached = true
          return Promise.resolve('sample-channel')
        },
        profileReady: () => true,
      }
      const ledger = { markPartial() {}, flush() {}, teardown() {} }
      const callbacks: Array<() => void> = []
      const context: any = {
        module: { exports: {} },
        console,
        process: { pid: 1 },
        performance: { mark() {} },
        window: { addEventListener() {} },
        setInterval: () => 1,
        clearInterval() {},
        require(name: string) {
          if (typeof name !== 'string') throw new TypeError('Module path must be a string')
          if (/^\.{1,2}\//.test(name)) throw new Error('Relative specifier refused')
          if (name === 'obsidian')
            return {
              Plugin: class {
                register(cb: () => void) {
                  callbacks.push(cb)
                }
              },
            }
          if (name === 'fs') return { ...fs, readFileSync: () => JSON.stringify(config) }
          if (name === 'path') return { join }
          if (name === 'node:events' || name.startsWith('@codemirror/')) return {}
          if (name === '@electron/remote')
            return {
              require: () => diagnostic,
              app: { getPath: () => root },
              getCurrentWebContents: () => ({ id: 1, session: {} }),
            }
          if (name === 'electron') return { ipcRenderer: { send() {} } }
          if (name === config.entryLedger)
            return {
              createEntryLedger: () => ledger,
              installEntryLedger: () => () => {},
              wrapProductExport: (value: unknown) => value,
            }
          if (name === config.failureDiagnostic) {
            if (loadedBoundary) throw controlledEnd
            return {
              shouldWrapFingerprints: () => false,
              captureFailures: () => ({ poll() {}, close() {} }),
            }
          }
          if (name === config.receiptCapture) return { scheduleHashWarmup() {} }
          if (name === config.interruptionBoundary) {
            loadedBoundary = true
            return nativeRequire(name)
          }
          throw new Error('Unexpected fixture dependency')
        },
      }
      runInNewContext(await readFile(new URL('./observer.cjs', import.meta.url), 'utf8'), context)
      const observer = new context.module.exports()
      observer.app = { vault: { adapter: { getBasePath: () => root } } }
      // Stop after the actual post-profiler helper imports; no app is started.
      void observer.onload().catch((error: unknown) => {
        failure = error
      })
      await new Promise((resolve) => setImmediate(resolve))
      for (const close of callbacks) close()
      expect(failure).toBe(controlledEnd)
      expect(reached).toBe(true)
      expect(loadedBoundary).toBe(true)
    })
  }
)
