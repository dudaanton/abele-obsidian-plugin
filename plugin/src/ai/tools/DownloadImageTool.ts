import type { AgentTool } from '../client'
import { requestUrl } from 'obsidian'
import { getAttachmentFolder } from './imageUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { nanoid } from 'nanoid'
import { substituteSecrets } from './secretUtils'

function extFromContentType(contentType: string): string | null {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('svg')) return 'svg'
  if (contentType.includes('bmp')) return 'bmp'
  if (contentType.includes('ico')) return 'ico'
  if (contentType.includes('pdf')) return 'pdf'
  return null
}

function extFromUrl(url: string): string | null {
  const urlExt = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase()
  if (
    urlExt &&
    [
      'jpg',
      'jpeg',
      'png',
      'gif',
      'webp',
      'svg',
      'bmp',
      'ico',
      'pdf',
      'zip',
      'json',
      'csv',
      'txt',
      'xml',
      'html',
    ].includes(urlExt)
  ) {
    return urlExt === 'jpeg' ? 'jpg' : urlExt
  }
  return null
}

async function downloadToVault(
  rawUrl: string,
  filename: string | undefined,
  defaultExt: string,
  overrideExt?: string,
  method?: string,
  rawHeaders?: Record<string, string>,
  body?: string
): Promise<string> {
  const url = substituteSecrets(rawUrl)

  // Substitute secrets in header values
  const headers: Record<string, string> = {}
  if (rawHeaders) {
    for (const [k, v] of Object.entries(rawHeaders)) {
      headers[k] = substituteSecrets(v)
    }
  }

  const reqOpts: {
    url: string
    method: string
    headers?: Record<string, string>
    body?: string
    contentType?: string
    throw: boolean
  } = {
    url,
    method: method || 'GET',
    throw: false,
  }
  if (Object.keys(headers).length) reqOpts.headers = headers
  if (body) {
    reqOpts.body = body
    if (!headers['content-type'] && !headers['Content-Type']) {
      reqOpts.contentType = 'application/json'
    }
  }

  const response = await requestUrl(reqOpts)
  if (response.status < 200 || response.status >= 300) {
    const text = response.text?.slice(0, 500) || ''
    throw new Error(`HTTP ${response.status}: ${text}`)
  }

  const contentType = response.headers['content-type'] || ''
  const ext = overrideExt || extFromContentType(contentType) || extFromUrl(url) || defaultExt

  const { app } = GlobalStore.getInstance()
  const folder = await getAttachmentFolder()
  const baseName = filename || `file-${nanoid(8)}`
  const basePath = folder ? `${folder}/${baseName}.${ext}` : `${baseName}.${ext}`

  let targetPath = basePath
  let counter = 1
  while (app.vault.getAbstractFileByPath(targetPath)) {
    targetPath = folder
      ? `${folder}/${baseName} ${counter}.${ext}`
      : `${baseName} ${counter}.${ext}`
    counter++
  }

  await app.vault.createBinary(targetPath, response.arrayBuffer)
  return targetPath
}

export function createDownloadImageTool(): AgentTool {
  return {
    name: 'download_image',
    label: 'Download Image',
    description:
      'Download an image from a URL and save it to the vault attachments folder. Returns the vault path of the saved file. You can pass custom headers (e.g. Authorization) for authenticated endpoints. Supports ${abele_key:name} substitution in the URL and header values.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Image URL to download' },
        filename: {
          type: 'string',
          description: 'Optional filename (without extension). Auto-generated if omitted.',
        },
        headers: {
          type: 'object',
          description:
            'HTTP headers as key-value pairs. Use ${abele_key:name} for secret substitution (e.g. {"Authorization": "Bearer ${abele_key:api_token}"}).',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['url'],
    },
    execute: async (_id, params) => {
      const url = params.url as string
      if (!url) throw new Error('Missing required parameter: url')
      const targetPath = await downloadToVault(
        url,
        params.filename as string | undefined,
        'png',
        undefined,
        undefined,
        params.headers as Record<string, string> | undefined
      )
      return { content: [{ type: 'text', text: `Saved: ${targetPath}` }] }
    },
  }
}

export function createDownloadFileTool(): AgentTool {
  return {
    name: 'download_file',
    label: 'Download File',
    description:
      'Download any file from a URL and save it to the vault attachments folder. Supports GET and POST requests, custom headers, and request body. Returns the vault path of the saved file. Supports ${abele_key:name} substitution in the URL and header values for API keys.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'File URL to download' },
        filename: {
          type: 'string',
          description: 'Optional filename (without extension). Auto-generated if omitted.',
        },
        extension: {
          type: 'string',
          description:
            'File extension to use (e.g. "mp3", "mp4", "pdf"). Overrides auto-detection from content-type.',
        },
        method: {
          type: 'string',
          description: 'HTTP method (default: GET). Use POST for APIs that return binary data.',
        },
        headers: {
          type: 'object',
          description:
            'HTTP headers as key-value pairs. Use ${abele_key:name} for secret substitution (e.g. {"xi-api-key": "${abele_key:elevenlabs}"}).',
          additionalProperties: { type: 'string' },
        },
        body: {
          type: 'string',
          description: 'Request body (JSON string). Content-Type defaults to application/json.',
        },
      },
      required: ['url'],
    },
    execute: async (_id, params) => {
      const url = params.url as string
      if (!url) throw new Error('Missing required parameter: url')
      const targetPath = await downloadToVault(
        url,
        params.filename as string | undefined,
        'bin',
        params.extension as string | undefined,
        params.method as string | undefined,
        params.headers as Record<string, string> | undefined,
        params.body as string | undefined
      )
      return { content: [{ type: 'text', text: `Saved: ${targetPath}` }] }
    },
  }
}
