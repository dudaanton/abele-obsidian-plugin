import { expect, it, vi } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { request } from '@/helpers/http'
import { useVault } from '../helpers/testEnv'

vi.mock('@/helpers/http', () => ({ request: vi.fn() }))

it.each(['content-type', 'Content-Type', 'CONTENT-TYPE'])(
  'decodes JSON from the %s response header',
  async (name) => {
    useVault([])
    vi.mocked(request).mockResolvedValue({
      status: 200,
      headers: { [name]: 'application/json; charset=utf-8' },
      text: '{"sample":true}',
    } as never)
    const script = buildScriptContext({
      params: {},
      signal: new AbortController().signal,
      logs: [],
      formHandler: async () => null,
    })
    const response = await script.fetch('https://sample.invalid/data')
    expect(response.data).toEqual({ sample: true })
  }
)

const context = () =>
  buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
it.each(['fetch', 'downloadFile', 'downloadImage'] as const)(
  '%s passes body limit and deadline to transport',
  async (method) => {
    useVault([])
    vi.mocked(request).mockRejectedValueOnce(new Error('transport sentinel'))
    await expect(
      context()[method]('https://sample.invalid/data', { maxBytes: 104857600, timeout: 1800000 })
    ).rejects.toThrow('transport sentinel')
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        maxBytes: 104857600,
        timeoutMs: 1800000,
        signal: expect.any(AbortSignal),
      })
    )
  }
)
it.each([0, -1, 1.5, NaN, Infinity, 209715201])('rejects invalid maxBytes %s', async (maxBytes) => {
  useVault([])
  await expect(context().fetch('https://sample.invalid/data', { maxBytes })).rejects.toThrow(
    /maxBytes.*209715200/
  )
})
it('rejects timeout above thirty minutes', async () => {
  useVault([])
  await expect(
    context().fetch('https://sample.invalid/data', { timeout: 1800001 })
  ).rejects.toThrow(/timeout.*1800000/)
})
it('explains how to raise the response limit', async () => {
  useVault([])
  vi.mocked(request).mockRejectedValueOnce(new Error('Response too large (limit 20971520 bytes)'))
  await expect(context().fetch('https://sample.invalid/data')).rejects.toThrow(/20971520.*maxBytes/)
})

it.each(['fetch', 'downloadFile', 'downloadImage'] as const)(
  '%s keeps the default limits',
  async (method) => {
    useVault([])
    vi.mocked(request).mockRejectedValueOnce(new Error('transport sentinel'))
    await expect(context()[method]('https://sample.invalid/data')).rejects.toThrow(
      'transport sentinel'
    )
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxBytes: 20971520, timeoutMs: 300000 })
    )
  }
)
it('accepts the exact size ceiling', async () => {
  useVault([])
  vi.mocked(request).mockRejectedValueOnce(new Error('transport sentinel'))
  await expect(
    context().fetch('https://sample.invalid/data', { maxBytes: 209715200 })
  ).rejects.toThrow('transport sentinel')
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ maxBytes: 209715200 }))
})
it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid timeout %s', async (timeout) => {
  useVault([])
  await expect(context().fetch('https://sample.invalid/data', { timeout })).rejects.toThrow(
    /timeout.*1800000/
  )
})
