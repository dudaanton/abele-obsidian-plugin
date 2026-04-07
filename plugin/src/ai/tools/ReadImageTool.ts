import { TFile } from 'obsidian'
import type { AgentTool, UserContentPart } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10 MB

export const VAULT_IMAGE_PREFIX = 'vault:'

export function isImagePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.includes(ext)
}

export function createReadImageTool(): AgentTool {
  return {
    name: 'read_image',
    label: 'Read Image',
    description:
      'Load an image so you can see its contents. Returns the image in the conversation. The path is relative to vault root — use the exact path as it appears in wikilinks (e.g. if a note has ![[photo.png]], use "photo.png"; if ![[assets/img.jpg]], use "assets/img.jpg").',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Image file path relative to vault root' },
      },
      required: ['path'],
    },
    execute: async (_id, params) => {
      const path = params.path as string
      if (!path) throw new Error('Missing required parameter: path')

      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)

      const ext = file.extension.toLowerCase()
      if (!IMAGE_EXTENSIONS.includes(ext)) {
        throw new Error(`Not an image file: ${path}`)
      }

      if (file.stat.size > MAX_IMAGE_SIZE) {
        const sizeMB = (file.stat.size / 1024 / 1024).toFixed(1)
        throw new Error(`Image too large: ${sizeMB} MB (max ${MAX_IMAGE_SIZE / 1024 / 1024} MB)`)
      }

      // Store vault reference — resolved to base64 on the fly before API calls
      const imageContent: UserContentPart[] = [
        { type: 'text', text: `[Image: ${path}]` },
        { type: 'image_url', image_url: { url: `${VAULT_IMAGE_PREFIX}${path}` } },
      ]

      return {
        content: [{ type: 'text', text: `Image loaded: ${path}` }],
        injectMessages: [{ role: 'user', content: imageContent, timestamp: Date.now() }],
      }
    },
  }
}
