import { beforeEach, expect, it, vi } from 'vitest'
import { callImageApi } from '@/ai/tools/imageApi'

const state = vi.hoisted(() => ({
  ai: {
    defaultImageModel: 'sample::image',
    imageGenerationTimeLimitMinutes: 0,
    imageProviders: [
      {
        id: 'sample',
        name: 'Sample',
        apiType: 'openai',
        apiKeyId: 'sample-key',
        models: [{ id: 'image' }],
      },
    ],
  },
  request: vi.fn(),
}))
vi.mock('@/services/AbeleConfig', () => ({ AbeleConfig: { getInstance: () => state } }))
vi.mock('@/secrets/destinations', () => ({ keyFor: () => 'fake-key' }))
vi.mock('@/helpers/http', () => ({ request: state.request }))

beforeEach(() => {
  state.ai.imageGenerationTimeLimitMinutes = 0
  state.ai.imageProviders[0].apiType = 'openai'
  state.request
    .mockReset()
    .mockResolvedValue({ status: 200, json: { data: [{ b64_json: 'AA==' }] } })
})

it.each([false, true])('uses no deadline and carries Stop for edit=%s', async (edit) => {
  const signal = new AbortController().signal
  await callImageApi({
    prompt: 'A sample shape',
    signal,
    sourceImages: edit ? ['data:image/png;base64,AA=='] : undefined,
  })
  expect(state.request).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 0, signal }))
})

it.each([2, 5, 10, 30])('applies the selected %s minute limit', async (minutes) => {
  state.ai.imageGenerationTimeLimitMinutes = minutes
  await callImageApi({ prompt: 'A sample shape' })
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({ timeoutMs: minutes * 60_000 })
  )
})

it('explains the selected limit and where to change it', async () => {
  state.ai.imageGenerationTimeLimitMinutes = 2
  state.request.mockRejectedValue(new Error('Request timed out after 120s'))
  await expect(callImageApi({ prompt: 'A sample shape' })).rejects.toThrow(
    /2.*Settings.*AI.*Models/
  )
})

it.each([false, true])('applies the same lifetime policy to OpenRouter edit=%s', async (edit) => {
  state.ai.imageProviders[0].apiType = 'openrouter'
  state.ai.imageGenerationTimeLimitMinutes = 30
  state.request.mockResolvedValue({
    status: 200,
    text: '{}',
    json: {
      choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,AA==' } }] } }],
    },
  })
  const signal = new AbortController().signal
  await callImageApi({
    prompt: 'A shape',
    signal,
    sourceImages: edit ? ['data:image/png;base64,AA=='] : undefined,
  })
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({ timeoutMs: 1_800_000, signal })
  )
})
