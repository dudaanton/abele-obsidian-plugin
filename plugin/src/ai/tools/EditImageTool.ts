import type { AgentTool } from '../client'
import { ScopeResolver } from '../ScopeResolver'
import { readImageAsDataUrl, saveImageToVault } from './imageUtils'
import { callImageApi, listImageModelKeys } from './imageApi'

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
        model: {
          type: 'string',
          description:
            'Optional image model key (provider::model). If omitted, uses the default image model. Available models: ' +
            (listImageModelKeys().join(', ') || 'none configured'),
        },
      },
      required: ['source', 'prompt'],
    },
    execute: async (_id, params) => {
      let rawSource = params.source
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

      const sourceImages = await Promise.all(sources.map((src) => readImageAsDataUrl(src)))
      const modelKey = (params.model as string) || undefined
      const result = await callImageApi({ prompt, sourceImages, modelKey })

      if (!result.dataUrl) {
        return {
          content: [{ type: 'text', text: result.text || 'No edited image returned' }],
        }
      }

      const savedPath = await saveImageToVault(result.dataUrl)
      scope.addFile(savedPath)
      const text = result.text
        ? `${result.text}\n\nEdited image saved: ${savedPath}`
        : `Edited image saved: ${savedPath}`

      return {
        content: [{ type: 'text', text }],
        details: { imagePath: savedPath },
      }
    },
  }
}
