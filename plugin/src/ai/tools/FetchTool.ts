import type { AgentTool } from '../client'
import { requestUrl } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { substituteSecrets } from './secretUtils'

const MAX_RESPONSE_SIZE = 100 * 1024 // 100 KB

function substituteInHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = substituteSecrets(value)
  }
  return result
}

export function createFetchTool(): AgentTool {
  const secrets = AbeleConfig.getInstance().ai.secrets || []
  const secretNames = secrets.map((s) => s.name).filter(Boolean)

  let description =
    'Send an HTTP request to any URL. Supports GET, POST, PUT, PATCH, DELETE. Returns status code, headers, and response body. You can pass custom headers (e.g. Authorization, Content-Type) as key-value pairs. Use this to interact with APIs, fetch web pages, or download data.'

  if (secretNames.length > 0) {
    description += `\n\nAvailable secrets for authentication (use as \${abele_key:name} in url, headers, or body — they will be substituted with actual values): ${secretNames.join(', ')}`
  }

  return {
    name: 'fetch',
    label: 'Fetch URL',
    description,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to request' },
        method: {
          type: 'string',
          description: 'HTTP method (default GET)',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
        },
        headers: {
          type: 'object',
          description: 'Request headers as key-value pairs',
          additionalProperties: { type: 'string' },
        },
        body: {
          type: 'string',
          description: 'Request body (for POST/PUT/PATCH). Send JSON as a string.',
        },
      },
      required: ['url'],
    },
    execute: async (_id, params) => {
      const rawUrl = params.url as string
      if (!rawUrl) throw new Error('Missing required parameter: url')

      const url = substituteSecrets(rawUrl)
      const method = ((params.method as string) || 'GET').toUpperCase()
      const headers = substituteInHeaders((params.headers as Record<string, string>) || {})
      const rawBody = params.body as string | undefined
      const body = rawBody ? substituteSecrets(rawBody) : undefined

      const response = await requestUrl({
        url,
        method,
        headers,
        body: body || undefined,
        throw: false,
      })

      let responseBody = ''
      const contentType = response.headers['content-type'] || ''

      if (contentType.includes('application/json')) {
        try {
          responseBody = JSON.stringify(response.json, null, 2)
        } catch {
          responseBody = response.text
        }
      } else {
        responseBody = response.text
      }

      if (responseBody.length > MAX_RESPONSE_SIZE) {
        responseBody = responseBody.slice(0, MAX_RESPONSE_SIZE) + '\n\n[... truncated]'
      }

      const result = [`HTTP ${response.status}`, responseBody].join('\n\n')

      return { content: [{ type: 'text', text: result }] }
    },
  }
}
