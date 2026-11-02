// @vitest-environment node
import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

it('keeps native async hooks out of the profiled renderer and declares ledger coverage partial', async () => {
  const source = await readFile(new URL('./observer.cjs', import.meta.url), 'utf8')
  let nativeHooks = 0
  const partial: string[] = []
  const config = { entryLedger: 'ledger', diagnostics: 'diagnostic', continuousCpu: true,
    profileDirectory: '/sample', device: '0' }
  const context: any = { module: { exports: {} }, require(name: string) {
    if (name === 'obsidian') return { Plugin: class {} }
    if (name === 'fs') return { readFileSync: () => JSON.stringify(config), mkdirSync() {} }
    if (name === 'path') return { join: (...parts: string[]) => parts.join('/') }
    if (name === '@electron/remote') return { require: () => ({ openEvidencePort: () => 'sample' }),
      getCurrentWebContents: () => ({ id: 1 }) }
    if (name === 'electron') return { ipcRenderer: {} }
    if (name === 'node:async_hooks') return { createHook() { nativeHooks++ } }
    if (name === 'node:events' || name.startsWith('@codemirror/')) return {}
    if (name === 'ledger') return {
      createEntryLedger: () => ({ markPartial: (reason: string) => partial.push(reason) }),
      installEntryLedger(options: any) {
        options.asyncHooks?.createHook()
        throw new Error('Controlled setup boundary')
      },
    }
    throw new Error('Unexpected fixture dependency')
  } }
  runInNewContext(source, context)
  const observer = new context.module.exports()
  observer.app = { vault: { adapter: { getBasePath: () => '/sample' } } }
  await expect(observer.onload()).rejects.toThrow('Controlled setup boundary')
  expect(nativeHooks).toBe(0)
  expect(partial).toContain('Native async callbacks require CPU attribution')
})
