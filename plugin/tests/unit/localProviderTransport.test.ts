import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { ModelConfig } from '@/ai/client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { setRequestGuard } from '@/helpers/http'
import { checkRequestDestinations, providerKey } from '@/secrets/destinations'
import { allowHttpOrigin } from '@/secrets/keyTransport'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [] }
  setRequestGuard((request) => checkRequestDestinations(request, AbeleConfig.getInstance()))
})
afterEach(() => {
  setRequestGuard(undefined)
  vi.restoreAllMocks()
})

async function ask(baseUrl: string, apiKey: string) {
  const events = []
  const model = { id: 'sample-model', baseUrl, apiKey, maxTokens: 100 } as ModelConfig
  for await (const event of new OpenAIClient().stream(
    model,
    '',
    [{ role: 'user', content: 'Hello sample model', timestamp: 1 }],
    []
  ))
    events.push(event)
  return events
}

const reply = () =>
  new Response(
    'data: {"choices":[{"delta":{"content":"Sample reply"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
  )

describe('local OpenAI-compatible providers with the production request guard', () => {
  it.each([
    ['localhost without a key', 'http://localhost:1234/v1', ''],
    ['localhost with a dummy key', 'http://localhost:1234/v1', 'none'],
    ['loopback with a dummy key', 'http://127.0.0.1:1234/v1', 'dummy'],
    ['home network without a key', 'http://192.168.8.20:1234/v1', ''],
    ['allowed home network with a dummy key', 'http://192.168.8.20:1234/v1', 'none'],
  ])('streams from %s', async (_label, baseUrl, apiKey) => {
    const app = useVault([])
    const config = AbeleConfig.getInstance()
    config.ai.providers = [
      { id: 'sample', name: 'Sample provider', baseUrl, apiKeyId: 'sample-key', models: [] },
    ]
    if (apiKey) app.secretStorage.setSecret('sample-key', apiKey)
    if (baseUrl.includes('192.168.')) allowHttpOrigin(baseUrl)
    const key = providerKey('sample-key', baseUrl, config)
    expect(key).toEqual({ apiKey })
    const fetch = vi.spyOn(window, 'fetch').mockImplementation(async () => reply())
    const events = await ask(baseUrl, key.apiKey)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe(`${baseUrl}/chat/completions`)
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      message: { stopReason: 'stop', content: [{ type: 'text', text: 'Sample reply' }] },
    })
  })

  it.each(['http://192.168.8.20:1234/v1', 'http://public.sample.invalid/v1'])(
    'still holds a dummy credential on unapproved HTTP at %s',
    async (baseUrl) => {
      const fetch = vi.spyOn(window, 'fetch').mockImplementation(async () => reply())
      const events = await ask(baseUrl, 'none')
      expect(fetch).not.toHaveBeenCalled()
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        message: { stopReason: 'error', errorMessage: expect.stringMatching(/unencrypted HTTP/) },
      })
    }
  )
})
