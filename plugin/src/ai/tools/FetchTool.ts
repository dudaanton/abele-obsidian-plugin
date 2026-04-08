import type { AgentTool } from '../client'
import { requestUrl } from 'obsidian'

const MAX_RESPONSE_SIZE = 100 * 1024 // 100 KB

export function createFetchTool(): AgentTool {
  return {
    name: 'fetch',
    label: 'Fetch URL',
    description:
      'Send an HTTP request to any URL. Supports GET, POST, PUT, PATCH, DELETE. Returns status code, headers, and response body. Use this to interact with APIs, fetch web pages, or download data.',
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
      const url = params.url as string
      if (!url) throw new Error('Missing required parameter: url')

      const method = ((params.method as string) || 'GET').toUpperCase()
      const headers = (params.headers as Record<string, string>) || {}
      const body = params.body as string | undefined

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
