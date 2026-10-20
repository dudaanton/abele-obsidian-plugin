import { expect, it, vi } from 'vitest'
import { createEditImageTool } from '@/ai/tools/EditImageTool'
import { callImageApi } from '@/ai/tools/imageApi'

vi.mock('@/ai/tools/imageApi', () => ({
  callImageApi: vi.fn(async () => ({ dataUrl: '', text: 'Sample response' })),
  imageModelParameter: () => ({ type: 'string' }),
}))
vi.mock('@/ai/tools/imageUtils', () => ({
  readImageAsDataUrl: async () => 'data:image/png;base64,AA==',
}))
vi.mock('@/ai/toolContext', () => ({ scopeOf: () => ({ isInScope: () => true }) }))

it('passes the chat Stop signal through image editing', async () => {
  const signal = new AbortController().signal
  await createEditImageTool().execute('sample', { source: 'sample.png', prompt: 'A shape' }, signal)
  expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({ signal }))
})
