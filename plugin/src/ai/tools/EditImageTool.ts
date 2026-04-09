import { requestUrl } from 'obsidian'
import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScopeResolver } from '../ScopeResolver'
import { readImageAsDataUrl, saveImageToVault } from './imageUtils'

export function createEditImageTool(): AgentTool {
  return {
    name: 'edit_image',
    label: 'Edit Image',
    description:
      'Edit an existing image using an AI model. Reads the source image from the vault, sends it with your prompt, and saves the result. Returns the vault path of the edited image.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Vault path of the source image to edit' },
        prompt: { type: 'string', description: 'Instructions for how to edit the image' },
      },
      required: ['source', 'prompt'],
    },
    execute: async (_id, params) => {
      const source = params.source as string
      const prompt = params.prompt as string
      if (!source) throw new Error('Missing required parameter: source')
      if (!prompt) throw new Error('Missing required parameter: prompt')

      if (!ScopeResolver.getInstance().isInScope(source)) {
        throw new Error(`File not in scope: ${source}`)
      }

      const config = AbeleConfig.getInstance()
      const secretId = config.ai.openRouterApiKey
      if (!secretId) throw new Error('OpenRouter API key not configured in settings')

      const apiKey = GlobalStore.getInstance().app.secretStorage.getSecret(secretId)
      if (!apiKey) throw new Error('OpenRouter API key not found in keychain')

      const model = config.ai.imageModel
      if (!model) throw new Error('Image model not configured in settings')

      // Read source image as base64 data URL
      const imageDataUrl = await readImageAsDataUrl(source)

      const response = await requestUrl({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
          ],
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
        const text = message.content || 'No edited image returned'
        return { content: [{ type: 'text', text }] }
      }

      const dataUrl = images[0].image_url.url
      const savedPath = await saveImageToVault(dataUrl)
      ScopeResolver.getInstance().addFile(savedPath)
      const text = message.content
        ? `${message.content}\n\nEdited image saved: ${savedPath}`
        : `Edited image saved: ${savedPath}`

      return {
        content: [{ type: 'text', text }],
        details: { imagePath: savedPath },
      }
    },
  }
}
