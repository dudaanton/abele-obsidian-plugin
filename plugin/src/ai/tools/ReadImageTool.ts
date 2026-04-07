import { TFile } from 'obsidian'
import type { AgentTool, UserContentPart } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  }
  return map[ext] || 'application/octet-stream'
}

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

      const binary = await app.vault.readBinary(file)
      const base64 = arrayBufferToBase64(binary)
      const mime = getMimeType(ext)
      const dataUrl = `data:${mime};base64,${base64}`

      const imageContent: UserContentPart[] = [
        { type: 'text', text: `[Image: ${path}]` },
        { type: 'image_url', image_url: { url: dataUrl } },
      ]

      return {
        content: [{ type: 'text', text: `Image loaded: ${path}` }],
        injectMessages: [{ role: 'user', content: imageContent, timestamp: Date.now() }],
      }
    },
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
