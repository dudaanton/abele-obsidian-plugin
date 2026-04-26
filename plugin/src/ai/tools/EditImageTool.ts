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
      'Edit one or more existing images using an AI model. Reads source images from the vault, sends them with your prompt, and saves the result. Use a single source path or an array of paths when combining/comparing multiple images. Returns the vault path of the edited image.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          oneOf: [
            { type: 'string', description: 'Vault path of a single source image' },
            {
              type: 'array',
              items: { type: 'string' },
              description: 'Vault paths of multiple source images',
            },
          ],
          description: 'One or more vault paths of source images to edit',
        },
        prompt: { type: 'string', description: 'Instructions for how to edit the image(s)' },
      },
      required: ['source', 'prompt'],
    },
    execute: async (_id, params) => {
      let rawSource = params.source
      // Model may pass a JSON string instead of an array
      if (typeof rawSource === 'string' && rawSource.startsWith('[')) {
        try {
          rawSource = JSON.parse(rawSource)
        } catch {
          // keep as string
        }
      }
      const sources = Array.isArray(rawSource) ? (rawSource as string[]) : [rawSource as string]
      const prompt = params.prompt as string
      if (!sources.length || !sources[0]) throw new Error('Missing required parameter: source')
      if (!prompt) throw new Error('Missing required parameter: prompt')

      const scope = ScopeResolver.getInstance()
      for (const src of sources) {
        if (!scope.isInScope(src)) {
          throw new Error(`File not in scope: ${src}`)
        }
      }

      const config = AbeleConfig.getInstance()
      const secretId = config.ai.openRouterApiKey
      if (!secretId) throw new Error('OpenRouter API key not configured in settings')

      const apiKey = GlobalStore.getInstance().app.secretStorage.getSecret(secretId)
      if (!apiKey) throw new Error('OpenRouter API key not found in keychain')

      const model = config.ai.imageModel
      if (!model) throw new Error('Image model not configured in settings')

      // Read all source images as base64 data URLs
      const imageDataUrls = await Promise.all(sources.map((src) => readImageAsDataUrl(src)))

      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: 'text', text: prompt },
        ...imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
      ]

      const response = await requestUrl({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content }],
          modalities: ['image', 'text'],
        }),
        throw: false,
      })

      if (response.status !== 200) {
        const body = response.text?.slice(0, 500) || ''
        throw new Error(`OpenRouter API error ${response.status}: ${body}`)
      }

      if (!response.text?.trim()) {
        throw new Error('Empty response from image model')
      }

      interface ImageResponse {
        choices?: Array<{
          message?: {
            content?: string
            images?: Array<{ image_url: { url: string } }>
          }
        }>
      }
      let data: ImageResponse
      try {
        data = response.json
      } catch {
        throw new Error(`Invalid JSON from image model: ${response.text.slice(0, 200)}`)
      }
      const message = data.choices?.[0]?.message
      if (!message) throw new Error('No response from image model')

      const images = message.images
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
