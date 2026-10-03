import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { initializeDestinations } from '@/secrets/destinations'
import { approveScriptKeyRequest } from '@/secrets/requestApproval'
import { needsSecretApproval, prepareSecretRequest } from '@/ai/tools/secretUtils'

const request = {
  url: 'https://api.sample.example/first',
  headers: { Authorization: '${abele_key:sample}' },
}
beforeEach(() => {
  const app = useVault([])
  app.secretStorage.setSecret('sample-key', 'sample-value')
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    secrets: [{ name: 'sample', keyId: 'sample-key' }],
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue()
  initializeDestinations(AbeleConfig.getInstance())
})
afterEach(() => document.body.replaceChildren())

describe('remembering a saved-key address from the request dialog', () => {
  it('reports a failed settings write as an Error without sending the request', async () => {
    vi.mocked(AbeleConfig.getInstance().saveSettings).mockRejectedValue('Synthetic save failure')
    const approval = approveScriptKeyRequest(request)
    const result = expect(approval).rejects.toEqual(new Error('Synthetic save failure'))
    const button = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Allow address and send'
    )!
    button.click()
    await result
    expect(needsSecretApproval('fetch', request)).toBe(true)
    expect(document.querySelector('.modal')).toBeNull()
  })
  it('persists the approval and does not ask again for another path on the same origin', async () => {
    const approval = approveScriptKeyRequest(request)
    const button = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Allow address and send'
    )!
    expect(button).toBeDefined()
    button.click()
    await approval
    expect(AbeleConfig.getInstance().saveSettings).toHaveBeenCalled()
    expect(AbeleConfig.getInstance().ai.secrets[0].allowedOrigins).toEqual([
      'https://api.sample.example',
    ])
    expect(prepareSecretRequest(request).headers.Authorization).toBe('sample-value')
    const next = { ...request, url: 'https://API.SAMPLE.EXAMPLE:443/next?q=2' }
    const repeated = approveScriptKeyRequest(next)
    // Clean up the old implementation's repeated question without leaving a pending promise.
    const unexpected = document.querySelector<HTMLButtonElement>('.abele-modal__footer button')
    unexpected?.click()
    await expect(repeated).resolves.toBeUndefined()
    expect(unexpected).toBeNull()
    expect(needsSecretApproval('fetch', next)).toBe(false)
    expect(prepareSecretRequest(next).headers.Authorization).toBe('sample-value')
    const controller = new AbortController()
    controller.abort()
    await expect(approveScriptKeyRequest(next, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(document.querySelector('.modal')).toBeNull()
  })
})
