import type { AgentTool } from '../client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScopeResolver } from '../ScopeResolver'
import { saveImageToVault } from './imageUtils'
import { callImageApi, listImageModelKeys } from './imageApi'

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
        model: {
          type: 'string',
          description:
            'Optional image model key (provider::model). If omitted, uses the default image model. Available models: ' +
            (listImageModelKeys().join(', ') || 'none configured'),
        },
      },
      required: ['prompt'],
    },
    execute: async (_id, params) => {
      const prompt = params.prompt as string
      if (!prompt) throw new Error('Missing required parameter: prompt')

      const modelKey = (params.model as string) || undefined
      const result = await callImageApi({ prompt, modelKey })

      if (!result.dataUrl) {
        return { content: [{ type: 'text', text: result.text || 'No image generated' }] }
      }

      const savedPath = await saveImageToVault(result.dataUrl)
      ScopeResolver.getInstance().addFile(savedPath)
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
