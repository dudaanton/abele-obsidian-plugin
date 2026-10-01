import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { buildWorkerSource, refusalFor } from '@/ai/tools/EvalJsTool'

function evaluate(code: string) {
  let result: { ok: boolean; value: string } | undefined
  const context = {
    postMessage: (value: typeof result) => {
      result = value
    },
    fetch: () => {
      throw new Error('NETWORK REACHED')
    },
    WebSocket: function () {
      throw new Error('NETWORK REACHED')
    },
    importScripts: () => {
      throw new Error('NETWORK REACHED')
    },
    Worker: function () {
      throw new Error('NETWORK REACHED')
    },
    setTimeout: () => {},
  }
  runInNewContext(`self = globalThis; ${buildWorkerSource(code)}`, context)
  return result!
}

describe('eval_js network isolation', () => {
  it('preserves calculations and console output', () => {
    expect(evaluate('console.log("sample"); 6 * 7')).toEqual({ ok: true, value: 'sample\n42' })
  })
  it.each(['fetch', 'WebSocket', 'importScripts', 'Worker', 'XMLHttpRequest', 'EventSource'])(
    'removes %s',
    (name) => {
      expect(evaluate(`typeof globalThis[${JSON.stringify(name)}]`).value).toBe('undefined')
    }
  )
  it.each([
    'Function("return fetch")()',
    '(()=>{}).constructor("return fetch")()',
    '(async()=>{}).constructor("return fetch")()',
    'eval("fetch")',
    'setTimeout("fetch()", 0)',
  ])('blocks generated code: %s', (code) => {
    expect(evaluate(code).ok).toBe(false)
  })
  it('refuses dynamic imports before starting the worker', () => {
    expect(refusalFor('import("https://sample.example/module.js")')).toMatch(/import/)
    expect(refusalFor('40 + 2')).toBeNull()
    expect(refusalFor('"import".toUpperCase()')).toBeNull()
    expect(refusalFor('// import is data here\n40 + 2')).toBeNull()
  })
  it('cannot recover network APIs through the global prototype', () => {
    let value: unknown
    runInNewContext(
      `self = globalThis; Object.setPrototypeOf(self, { fetch() { throw Error('NETWORK REACHED') } }); ${buildWorkerSource('typeof Object.getPrototypeOf(self).fetch')}`,
      {
        postMessage: (r: unknown) => {
          value = r
        },
      }
    )
    expect(value).toEqual({ ok: true, value: 'undefined' })
  })
})
