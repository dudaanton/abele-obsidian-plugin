import { requestUrl } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { IMAGE_API_DEFAULTS, ImageProvider, ImageModelConfig2, resolveImageModel } from '../types'

interface ImageApiRequest {
  prompt: string
  /** "providerId::modelId" — if omitted, uses defaultImageModel */
  modelKey?: string
  /** Base64 data URLs of source images (for editing) */
  sourceImages?: string[]
}

interface ImageApiResponse {
  dataUrl: string
  text?: string
}

/**
 * Resolve provider + model from a key, falling back to default.
 */
function resolve(modelKey?: string) {
  const cfg = AbeleConfig.getInstance().ai
  const key = modelKey || cfg.defaultImageModel
  if (!key) throw new Error('No image model configured. Set a default image model in settings.')

  const result = resolveImageModel(key, cfg.imageProviders)
  if (!result) throw new Error(`Image model not found: ${key}`)
  return result
}

/**
 * Get the API key from keychain.
 */
async function getApiKey(provider: ImageProvider): Promise<string> {
  if (!provider.apiKeyId)
    throw new Error(`API key not configured for image provider "${provider.name}"`)
  const key = await GlobalStore.getInstance().app.secretStorage.getSecret(provider.apiKeyId)
  if (!key) throw new Error(`API key not found in keychain for image provider "${provider.name}"`)
  return key
}

function getEndpoint(provider: ImageProvider): string {
  return provider.endpoint || IMAGE_API_DEFAULTS[provider.apiType]
}

/**
 * Convert a data URL to a Uint8Array.
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Build a multipart/form-data body manually (Obsidian requestUrl doesn't support FormData).
 */
function buildMultipart(
  fields: Record<string, string>,
  images: { name: string; data: Uint8Array; filename: string }[]
): { body: ArrayBuffer; contentType: string } {
  const boundary = '----AbeleMultipart' + Date.now().toString(36)
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []

  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
      )
    )
  }

  for (const img of images) {
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${img.name}"; filename="${img.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      )
    )
    parts.push(img.data)
    parts.push(encoder.encode('\r\n'))
  }

  parts.push(encoder.encode(`--${boundary}--\r\n`))

  let totalLength = 0
  for (const p of parts) totalLength += p.byteLength
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const p of parts) {
    result.set(p, offset)
    offset += p.byteLength
  }

  return { body: result.buffer, contentType: `multipart/form-data; boundary=${boundary}` }
}

/**
 * Call OpenAI /v1/images/generations or /v1/images/edits (when source images are provided).
 */
async function callOpenAi(
  apiKey: string,
  provider: ImageProvider,
  model: ImageModelConfig2,
  req: ImageApiRequest
): Promise<ImageApiResponse> {
  const baseEndpoint = getEndpoint(provider)
  const isEdit = !!req.sourceImages?.length
  const endpoint = isEdit ? baseEndpoint.replace(/\/generations\/?$/, '/edits') : baseEndpoint

  let response
  if (isEdit) {
    const fields: Record<string, string> = {
      model: model.id,
      prompt: req.prompt,
      n: '1',
      size: model.size || '1024x1024',
      quality: model.quality || 'medium',
      output_format: model.outputFormat || 'png',
    }
    const images = req.sourceImages!.map((dataUrl, i) => ({
      name: 'image[]',
      data: dataUrlToBytes(dataUrl),
      filename: `image${i}.png`,
    }))
    const { body, contentType } = buildMultipart(fields, images)

    response = await requestUrl({
      url: endpoint,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': contentType,
      },
      body,
      throw: false,
    })
  } else {
    const body: Record<string, unknown> = {
      model: model.id,
      prompt: req.prompt,
      n: 1,
      size: model.size || '1024x1024',
      quality: model.quality || 'medium',
      output_format: model.outputFormat || 'png',
    }

    response = await requestUrl({
      url: endpoint,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      throw: false,
    })
  }

  if (response.status !== 200) {
    const detail = response.text?.slice(0, 500) || ''
    throw new Error(`OpenAI API error ${response.status}: ${detail}`)
  }

  const data = response.json
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) throw new Error('No image data in OpenAI response')

  const fmt = model.outputFormat || 'png'
  const mime = fmt === 'jpg' || fmt === 'jpeg' ? 'jpeg' : fmt
  return {
    dataUrl: `data:image/${mime};base64,${b64}`,
    text: data?.data?.[0]?.revised_prompt,
  }
}

/**
 * Call OpenRouter /v1/chat/completions with modalities: ['image', 'text'].
 */
async function callOpenRouter(
  apiKey: string,
  provider: ImageProvider,
  model: ImageModelConfig2,
  req: ImageApiRequest
): Promise<ImageApiResponse> {
  const endpoint = getEndpoint(provider)

  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
  if (req.sourceImages?.length) {
    for (const url of req.sourceImages) {
      content.push({ type: 'image_url', image_url: { url } })
    }
  }
  content.push({ type: 'text', text: req.prompt })

  const response = await requestUrl({
    url: endpoint,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model.id,
      messages: [{ role: 'user', content }],
      modalities: ['image', 'text'],
    }),
    throw: false,
  })

  if (response.status !== 200) {
    const detail = response.text?.slice(0, 500) || ''
    throw new Error(`OpenRouter API error ${response.status}: ${detail}`)
  }

  if (!response.text?.trim()) throw new Error('Empty response from image model')

  const data = response.json
  const message = data?.choices?.[0]?.message
  if (!message) throw new Error('No response from image model')

  const images = message.images as Array<{ image_url: { url: string } }> | undefined
  if (!images?.length) {
    return { dataUrl: '', text: message.content || 'No image generated' }
  }

  return {
    dataUrl: images[0].image_url.url,
    text: message.content || undefined,
  }
}

/**
 * Generate or edit an image using the configured API.
 * @param req.modelKey — "providerId::modelId", falls back to defaultImageModel
 */
export async function callImageApi(req: ImageApiRequest): Promise<ImageApiResponse> {
  const { provider, model } = resolve(req.modelKey)
  const apiKey = await getApiKey(provider)

  if (provider.apiType === 'openai') {
    return callOpenAi(apiKey, provider, model, req)
  }
  return callOpenRouter(apiKey, provider, model, req)
}

/**
 * List all available image model keys for tool descriptions.
 */
export function listImageModelKeys(): string[] {
  const cfg = AbeleConfig.getInstance().ai
  const keys: string[] = []
  for (const p of cfg.imageProviders) {
    for (const m of p.models) {
      keys.push(`${p.id}::${m.id}`)
    }
  }
  return keys
}
