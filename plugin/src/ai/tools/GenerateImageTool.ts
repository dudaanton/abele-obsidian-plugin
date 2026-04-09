import { requestUrl } from 'obsidian'
import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScopeResolver } from '../ScopeResolver'
import { saveImageToVault } from './imageUtils'

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
      },
      required: ['prompt'],
    },
    execute: async (_id, params) => {
      const prompt = params.prompt as string
      if (!prompt) throw new Error('Missing required parameter: prompt')

      const config = AbeleConfig.getInstance()
      const secretId = config.ai.openRouterApiKey
      if (!secretId) throw new Error('OpenRouter API key not configured in settings')

      const apiKey = GlobalStore.getInstance().app.secretStorage.getSecret(secretId)
      if (!apiKey) throw new Error('OpenRouter API key not found in keychain')

      const model = config.ai.imageModel
      if (!model) throw new Error('Image model not configured in settings')

      const response = await requestUrl({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          modalities: ['image', 'text'],
        }),
        throw: false,
      })

      if (response.status !== 200) {
        const body = response.text?.slice(0, 500) || ''
        throw new Error(`OpenRouter API error ${response.status}: ${body}`)
      }

      const data = response.json
      const message = data?.choices?.[0]?.message
      if (!message) throw new Error('No response from image model')

      const images = message.images as Array<{ image_url: { url: string } }> | undefined
      if (!images?.length) {
        // Model returned text but no image
        const text = message.content || 'No image generated'
        return { content: [{ type: 'text', text }] }
      }

      const dataUrl = images[0].image_url.url
      const savedPath = await saveImageToVault(dataUrl)
      ScopeResolver.getInstance().addFile(savedPath)
      const text = message.content
        ? `${message.content}\n\nImage saved: ${savedPath}`
        : `Image saved: ${savedPath}`

      return {
        content: [{ type: 'text', text }],
        details: { imagePath: savedPath },
      }
    },
  }
}
