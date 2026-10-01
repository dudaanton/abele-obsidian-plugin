import type { AgentTool } from '../client'
import { scopeOf } from '../toolContext'
import { saveImageToVault } from './imageUtils'
import { callImageApi, imageModelParameter } from './imageApi'

export function createGenerateImageTool(): AgentTool {
  return {
    name: 'generate_image',
    label: 'Generate Image',
    description:
      'Generate an image from a text prompt using an AI model. The image is saved to the vault attachments folder. Returns the vault path of the saved image.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text description of the image to generate' },
        model: imageModelParameter(),
      },
      required: ['prompt'],
    },
    execute: async (_id, params, signal, ctx) => {
      signal?.throwIfAborted()
      const prompt = params.prompt as string
      if (!prompt) throw new Error('Missing required parameter: prompt')

      const modelKey = (params.model as string) || undefined
      const result = await callImageApi({ prompt, modelKey, signal })

      if (!result.dataUrl) {
        return { content: [{ type: 'text', text: result.text || 'No image generated' }] }
      }

      const savedPath = await saveImageToVault(result.dataUrl, undefined, signal)
      scopeOf(ctx).addFile(savedPath)
      const text = result.text
        ? `${result.text}\n\nImage saved: ${savedPath}`
        : `Image saved: ${savedPath}`

      return {
        content: [{ type: 'text', text }],
        details: { imagePath: savedPath },
      }
    },
  }
}
