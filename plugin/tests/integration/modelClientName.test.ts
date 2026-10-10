import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { collectEntries, applyEntries } from '@/transfer/entries'
import { transcriptionOptions } from '@/ai/transcriptionSettings'
import { transcribe } from '@/ai/transcription'
import { callImageApi } from '@/ai/tools/imageApi'
import { requestUrl } from 'obsidian'
import { secrets } from '@/secrets/SecretStore'
import type { Message } from '@/ai/client/types'
import type { AbeleSettings } from '@/services/AbeleConfig'

vi.mock('obsidian', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../mocks/obsidian')),
  requestUrl: vi.fn(),
}))
import { useVault } from '../helpers/testEnv'

const model = {
  id: 'sample-model',
  name: 'Sample model',
  contextWindow: 1000,
  maxTokens: 100,
  supportsReasoning: false,
}
const provider = {
  id: 'sample-provider',
  name: 'Sample provider',
  baseUrl: 'https://model.example.invalid/v1',
  apiKeyId: '',
  clientName: 'SampleClient/1.0',
  models: [model],
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().applySettings(undefined)
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    activeProviderId: provider.id,
    activeModelId: model.id,
    auxiliaryModelId: `${provider.id}::${model.id}`,
    voice: {
      modelId: model.id,
      endpoint: provider.baseUrl,
      apiKeyId: '',
      language: '',
      clientName: 'VoiceClient/1.0',
    },
  }
})
afterEach(() => {
  vi.restoreAllMocks()
  ChatService.getInstance().destroy()
  AgentRegistry.destroy()
  AbeleConfig.getInstance().destroy()
})

const sse =
  'data: {"choices":[{"delta":{"content":"Sample answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'

async function turn(clientName?: string, messages: Message[] = []) {
  const events = []
  for await (const event of new OpenAIClient().stream(
    { ...model, baseUrl: provider.baseUrl, apiKey: '', clientName },
    '',
    messages,
    []
  ))
    events.push(event)
  return events
}

describe('per-connection client name', () => {
  it('reaches active, per-chat, auxiliary, primary, fallback and background agent models', () => {
    const service = ChatService.getInstance()
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({
      name: 'Sample agent',
      providerId: provider.id,
      modelId: model.id,
      fallbackProviderId: provider.id,
      fallbackModelId: model.id,
      auxiliaryProviderId: provider.id,
      auxiliaryModelId: model.id,
    })
    const configs = [
      service.getActiveModelConfig(),
      service.getModelConfigFor(provider.id, model.id),
      service.getAuxiliaryModelConfig(),
      registry.resolveModel(agent),
      registry.resolveModel(agent, { fallback: true }),
      registry.resolveModel(agent, { background: true }),
    ]
    for (const config of configs) expect(config).toHaveProperty('clientName', provider.clientName)
  })

  it('adds User-Agent to streamed chat, including image messages', async () => {
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(sse))
    expect(
      (
        await turn(provider.clientName, [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this sample' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
            ],
          },
        ])
      ).at(-1)?.type
    ).toBe('done')
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ 'User-Agent': provider.clientName })
  })

  it.each([undefined, '', '   '])(
    'does not add identifying headers for an empty name (%s)',
    async (clientName) => {
      const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(sse))
      await turn(clientName)
      expect(fetch.mock.calls[0][1]?.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer ',
      })
    }
  )

  it('adds User-Agent to model listing, with unchanged defaults', async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      headers: {},
      text: '',
      json: { data: [] },
      arrayBuffer: new ArrayBuffer(0),
    })
    const client = new OpenAIClient()
    await client.fetchModels(provider.baseUrl, 'sample-key', provider.clientName)
    expect(vi.mocked(requestUrl).mock.calls.at(-1)?.[0]).toMatchObject({
      headers: { Authorization: 'Bearer sample-key', 'User-Agent': provider.clientName },
    })
    await client.fetchModels(provider.baseUrl, 'sample-key')
    expect(vi.mocked(requestUrl).mock.calls.at(-1)?.[0]).toMatchObject({
      headers: { Authorization: 'Bearer sample-key' },
    })
    expect(
      (vi.mocked(requestUrl).mock.calls.at(-1)?.[0] as { headers: object }).headers
    ).not.toHaveProperty('User-Agent')
  })

  it('passes the voice connection name to transcription requests', async () => {
    const options = transcriptionOptions()
    expect(options).toHaveProperty('clientName', 'VoiceClient/1.0')
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      headers: {},
      text: '',
      json: { choices: [{ message: { content: 'Sample words' } }] },
      arrayBuffer: new ArrayBuffer(0),
    })
    await transcribe(new Uint8Array([0]), { ...options, apiKey: 'sample-key' })
    expect(vi.mocked(requestUrl).mock.calls.at(-1)?.[0]).toMatchObject({
      headers: { 'User-Agent': 'VoiceClient/1.0' },
    })
    await transcribe(new Uint8Array([0]), { ...options, apiKey: 'sample-key', clientName: '' })
    expect((vi.mocked(requestUrl).mock.calls.at(-1)?.[0] as { headers: object }).headers).toEqual({
      Authorization: 'Bearer sample-key',
      'Content-Type': 'application/json',
    })
  })

  it.each(['openai', 'openrouter'] as const)(
    'uses the image connection name for %s generation and editing',
    async (apiType) => {
      const config = AbeleConfig.getInstance()
      config.ai.imageProviders = [
        {
          id: 'sample-image',
          name: 'Sample image',
          apiType,
          endpoint: '',
          apiKeyId: 'sample-slot',
          clientName: 'ImageClient/1.0',
          models: [{ id: 'sample-image-model', name: '', size: '', quality: '', outputFormat: '' }],
        },
      ]
      vi.spyOn(secrets(), 'get').mockReturnValue('sample-key')
      vi.mocked(requestUrl).mockResolvedValue({
        status: 200,
        headers: {},
        text: '{}',
        json: {
          data: [{ b64_json: 'AA==' }],
          choices: [
            { message: { images: [{ image_url: { url: 'data:image/png;base64,AA==' } }] } },
          ],
        },
        arrayBuffer: new ArrayBuffer(0),
      })
      for (const sourceImages of [undefined, ['data:image/png;base64,AA==']]) {
        await callImageApi({
          modelKey: 'sample-image::sample-image-model',
          prompt: 'Sample image',
          sourceImages,
        })
        expect(vi.mocked(requestUrl).mock.calls.at(-1)?.[0]).toMatchObject({
          headers: { 'User-Agent': 'ImageClient/1.0' },
        })
      }
      config.ai.imageProviders[0].clientName = ''
      await callImageApi({ modelKey: 'sample-image::sample-image-model', prompt: 'Sample image' })
      expect((vi.mocked(requestUrl).mock.calls.at(-1)?.[0] as { headers: object }).headers).toEqual(
        {
          Authorization: 'Bearer sample-key',
          'Content-Type': 'application/json',
        }
      )
    }
  )

  it('carries model, image and voice connection names through settings transfer', () => {
    const settings = AbeleConfig.getInstance() as AbeleSettings
    settings.ai.imageProviders = [
      {
        id: 'sample-image',
        name: 'Sample image',
        apiType: 'openai',
        endpoint: '',
        apiKeyId: '',
        models: [],
        clientName: 'ImageClient/1.0',
      },
    ]
    const arriving = applyEntries(collectEntries(settings), { ai: {} } as typeof settings)
    expect(arriving.ai.providers[0]).toHaveProperty('clientName', provider.clientName)
    expect(arriving.ai.imageProviders[0]).toHaveProperty('clientName', 'ImageClient/1.0')
    expect(arriving.ai.voice).toHaveProperty('clientName', 'VoiceClient/1.0')
  })
})
