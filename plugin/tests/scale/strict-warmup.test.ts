// @vitest-environment node
import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const capture = require('./receipt-capture.cjs')
const { SHA256: ActualSHA256 } = require('@noble/hashes/sha2.js')

async function launch(strict: boolean, stale = false) {
  const source = await readFile(new URL('./observer.cjs', import.meta.url), 'utf8')
  const jobs: Array<() => void> = [], events: any[] = []
  let staleCalls = 0, constructed = 0
  const config = { strictRestartMeasurement: strict, continuousCpu: true,
    receiptCapture: 'capture', diagnostics: 'diagnostic', device: '0' }
  const diagnostic = { openEvidencePort: () => 'sample', watch: async () => {
    throw new Error('Controlled fixture boundary')
  } }
  const context: any = { module: { exports: {} }, ActualSHA256,
    constructed: () => { constructed++ },
    require(name: string) {
      if (name === 'obsidian') return { Plugin: class {} }
      if (name === 'fs') return { readFileSync: () => JSON.stringify(config) }
      if (name === 'path') return { join: (...parts: string[]) => parts.join('/') }
      if (name === '@electron/remote') return { require: () => diagnostic, getCurrentWebContents: () => ({ id: 1 }) }
      if (name === 'electron') return { ipcRenderer: { send: (_channel: string, value: string) => events.push(JSON.parse(value)) } }
      if (name === 'capture') return { scheduleHashWarmup: (work: () => void, emit: any) =>
        capture.scheduleHashWarmup(work, emit, (job: () => void) => jobs.push(job)) }
      throw new Error('Unexpected fixture dependency')
    } }
  if (stale) context.__scaleWarmHashConstructors = () => { staleCalls++ }
  runInNewContext(source, context)
  const observer = new context.module.exports()
  observer.app = { vault: { adapter: { getBasePath: () => '/sample' } } }
  // Stop after the actual observer has configured warm-up, before any product
  // enable. The profiler failure is intentional and starts no real process.
  await expect(observer.onload()).rejects.toThrow('Continuous profiling required before product load')
  const installed = typeof context.__scaleWarmHashConstructors === 'function'
  runInNewContext(capture.instrumentReceiptAccess(`
    function durableHostOf() {} function storageOf() {} class BoundedVaultIo {}
    class SHA256 extends ActualSHA256 { constructor() { super(); constructed(); } }
  `), context)
  for (const job of jobs) job()
  return { installed, jobs: jobs.length, constructed, staleCalls,
    warmups: events.filter(row => row.event === 'javascript-hash-tracepoint-setup') }
}

it.each([false, true])('does not install or run strict-restart warm-up (stale callback: %s)', async stale => {
  expect(await launch(true, stale)).toEqual({ installed: false, jobs: 0, constructed: 0, staleCalls: 0, warmups: [] })
})

it('keeps real hash warm-up and its setup receipt on ordinary launches', async () => {
  const result = await launch(false)
  expect(result).toMatchObject({ installed: true, jobs: 1, constructed: 1, staleCalls: 0 })
  expect(result.warmups).toHaveLength(1)
  expect(result.warmups[0].phase).toBe('warm-up')
})
