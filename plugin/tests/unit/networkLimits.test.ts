import { afterEach, describe, expect, it, vi } from 'vitest'
import { request, setRequestTransport } from '@/helpers/http'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

afterEach(() => {
  setRequestTransport(undefined)
  vi.useRealTimers()
})
describe('network limits', () => {
  it('ends waiting for a stalled service', async () => {
    vi.useFakeTimers()
    setRequestTransport(() => new Promise(() => {}))
    const check = expect(request({ url: 'https://sample.example/' })).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(30_001)
    await check
  })
  it('rejects oversized bodies before JSON is accessed', async () => {
    const json = vi.fn()
    setRequestTransport(async () => ({
      status: 200,
      headers: {},
      text: '',
      get json() {
        json()
        return {}
      },
      arrayBuffer: new ArrayBuffer(101),
    }))
    await expect(request({ url: 'https://sample.example/', maxBytes: 100 })).rejects.toThrow(
      /too large/i
    )
    expect(json).not.toHaveBeenCalled()
  })
  it('checks declared lengths too', async () => {
    setRequestTransport(async () => ({
      status: 200,
      headers: { 'Content-Length': '101' },
      text: '',
      json: {},
      arrayBuffer: new ArrayBuffer(0),
    }))
    await expect(request({ url: 'https://sample.example/', maxBytes: 100 })).rejects.toThrow(
      /too large/i
    )
  })
  it.each([undefined, 0, -1, 600_000])(
    'caps script fetch at five minutes (timeout %s)',
    async (timeout) => {
      useVault([])
      AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
      vi.useFakeTimers()
      setRequestTransport(() => new Promise(() => {}))
      const ctx = buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
      let settled = false
      const work = ctx.fetch('https://sample.example/', { timeout })
      work.catch(() => {
        settled = true
      })
      const check = expect(work).rejects.toThrow(/timed out after 300s/)
      await vi.advanceTimersByTimeAsync(299_999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      await check
    }
  )
})
