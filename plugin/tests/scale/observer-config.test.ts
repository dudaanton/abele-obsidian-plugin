// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, copyFile, readFile, rm, stat } from 'node:fs/promises'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { qualificationScenario, qualificationInstrumentation } from './qualification-config.mjs'
import { observerDeploymentConfig } from './observer-config.mjs'

const modules = {
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

async function deployed(mode: string, check: (config: any, root: string) => Promise<void>) {
  await mkdir('.scratch', { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.scratch/observer-config-'))
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
        expect(config[key].endsWith('/' + name)).toBe(true)
        expect((await stat(config[key])).isFile()).toBe(true)
      }
      for (const key of Object.keys(qualificationInstrumentation))
        expect(typeof config[key], key).toBe('boolean')
    })
  }
)

it.each(['targeted', 'full'])(
  '%s actual observer reaches profiler startup with deployed options',
  async (mode) => {
    await deployed(mode, async (config, root) => {
      let reached = false,
        failure: unknown
      const diagnostic = {
        openEvidencePort: () => 'sample-channel',
        watch: () => {
          reached = true
          return new Promise(() => {})
        },
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
          if (name === config.failureDiagnostic)
            return {
              shouldWrapFingerprints: () => false,
              captureFailures: () => ({ poll() {}, close() {} }),
            }
          if (name === config.receiptCapture) return { scheduleHashWarmup() {} }
          throw new Error('Unexpected fixture dependency')
        },
      }
      runInNewContext(await readFile(new URL('./observer.cjs', import.meta.url), 'utf8'), context)
      const observer = new context.module.exports()
      observer.app = { vault: { adapter: { getBasePath: () => root } } }
      // Pause at the real profiler boundary: no host, inspector or app is started.
      void observer.onload().catch((error: unknown) => {
        failure = error
      })
      await new Promise((resolve) => setImmediate(resolve))
      for (const close of callbacks) close()
      expect(failure).toBeUndefined()
      expect(reached).toBe(true)
    })
  }
)
