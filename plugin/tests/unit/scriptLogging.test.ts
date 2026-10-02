import { expect, it, vi } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { useVault } from '../helpers/testEnv'

it('logs cyclic objects without terminating the script', () => {
  useVault([])
  const logs: string[] = []
  const onLog = vi.fn()
  const script = buildScriptContext({
    params: {},
    signal: new AbortController().signal,
    logs,
    onLog,
    formHandler: async () => null,
  })
  const value: { sample: string; self?: unknown } = { sample: 'kept' }
  value.self = value
  expect(() => script.log(value)).not.toThrow()
  expect(logs[0]).toContain('"sample":"kept"')
  expect(logs[0]).toContain('[Circular]')
  expect(onLog).toHaveBeenCalledWith(logs[0])
})

it('does not label repeated non-cyclic objects as cycles', () => {
  useVault([])
  const logs: string[] = []
  const script = buildScriptContext({
    params: {},
    signal: new AbortController().signal,
    logs,
    formHandler: async () => null,
  })
  const value = { sample: true }
  script.log({ first: value, second: value })
  expect(logs).toEqual(['{"first":{"sample":true},"second":{"sample":true}}'])
})
