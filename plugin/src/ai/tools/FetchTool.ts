import type { AgentTool } from '../client'
import { request as requestUrl } from '@/helpers/http'
import { AbeleConfig } from '@/services/AbeleConfig'
import { prepareSecretRequest, redactSecrets } from './secretUtils'
import { describedLazily } from './lazyDescription'
import { BASIC_AUTH_PARAMETER } from '@/secrets/basicAuth'
import type { SecretRequest } from './secretUtils'

const MAX_RESPONSE_SIZE = 100 * 1024 // 100 KB

const FETCH_DESCRIPTION =
  'Send an HTTP request to any URL. Supports GET, POST, PUT, PATCH, DELETE. Returns status code, headers, and response body. You can pass custom headers (e.g. Authorization, Content-Type) as key-value pairs. Use this to interact with APIs, fetch web pages, or download data. For HTTP Basic authentication use basicAuth with a plain username and password: ${abele_key:name}; the saved password is resolved and encoded internally after consent.'

/** The description, with the secrets the person named listed for the agent. */
function describe(): string {
  const secrets = AbeleConfig.getInstance().ai?.secrets ?? []
  const names = secrets.map((s) => s.name).filter(Boolean)
  if (names.length === 0) return FETCH_DESCRIPTION
  return `${FETCH_DESCRIPTION}\n\nAvailable secrets for authentication (use as \${abele_key:name} in url, headers, or body — they will be substituted with actual values): ${names.join(', ')}`
}

export function createFetchTool(): AgentTool {
  const tool: Omit<AgentTool, 'description'> = {
    name: 'fetch',
    label: 'Fetch URL',
    parameters: {
      type: 'object',
      properties: {
        basicAuth: BASIC_AUTH_PARAMETER,
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

      const prepared = prepareSecretRequest({
        url: rawUrl,
        headers: (params.headers as Record<string, string>) || {},
        body: params.body as string | undefined,
        basicAuth: params.basicAuth as SecretRequest['basicAuth'],
      })
      const method = ((params.method as string) || 'GET').toUpperCase()
      const response = await requestUrl({ ...prepared, method, throw: false })

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

      const result = redactSecrets(
        [`HTTP ${response.status}`, responseBody].join('\n\n'),
        prepared.secretValues
      )

      return { content: [{ type: 'text', text: result }] }
    },
  }
  return describedLazily(tool, describe)
}
