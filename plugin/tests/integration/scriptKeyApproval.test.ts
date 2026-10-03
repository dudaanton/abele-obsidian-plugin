import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { allowSecretOrigin } from '@/ai/tools/secretUtils'
import { initializeDestinations } from '@/secrets/destinations'

const mocks = vi.hoisted(() => ({ approve: vi.fn(), request: vi.fn() }))
vi.mock('@/secrets/requestApproval', () => ({ approveScriptKeyRequest: mocks.approve }))
vi.mock('obsidian', async () => ({
  ...(await vi.importActual('../mocks/obsidian')),
  requestUrl: mocks.request,
}))
beforeEach(async () => {
  const app = useVault([])
  app.secretStorage.setSecret('sample-key', 'sample-value')
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    secrets: [{ name: 'sample', keyId: 'sample-key' }],
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue()
  initializeDestinations(AbeleConfig.getInstance())
  await allowSecretOrigin('sample', 'https://api.sample.example')
  mocks.approve.mockReset().mockResolvedValue(undefined)
  mocks.request.mockReset().mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'text/plain' },
    text: 'sample-value',
    arrayBuffer: new ArrayBuffer(0),
  })
})
describe('script saved-key confirmation boundary', () => {
  it('checks approval on every fetch and redacts an echo', async () => {
    const ctx = buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
    for (let i = 0; i < 2; i++) {
      const result = await ctx.fetch('https://api.sample.example/data', {
        headers: { 'X-Sample': '${abele_key:sample}' },
      })
      expect(result.text).toBe('[saved key]')
    }
    expect(mocks.approve).toHaveBeenCalledTimes(2)
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(mocks.request.mock.calls[0][0].headers['X-Sample']).toBe('sample-value')
  })
  it('never sends when the question is refused', async () => {
    mocks.approve.mockRejectedValue(new Error('Not approved'))
    const ctx = buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
    await expect(
      ctx.fetch('https://api.sample.example/data', { body: '${abele_key:sample}' })
    ).rejects.toThrow('Not approved')
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
