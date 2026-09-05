import type { AgentTool } from '../client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { requestUrl } from 'obsidian'

export function createWebSearchTool(): AgentTool {
  return {
    name: 'web_search',
    label: 'Web Search',
    description: 'Search the web using Brave Search. Returns titles, URLs, and descriptions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results (default 5, max 20)' },
      },
      required: ['query'],
    },
    execute: async (_toolCallId, params: Record<string, unknown>) => {
      const query = params.query as string
      if (!query) throw new Error('Missing required parameter: query')
      const count = Math.min((params.count as number) || 5, 20)
      const secretId = AbeleConfig.getInstance().ai.braveSearchApiKey
      if (!secretId) throw new Error('Brave Search API key is not configured in settings')
      const apiKey = GlobalStore.getInstance().app.secretStorage.getSecret(secretId)
      if (!apiKey) throw new Error('Brave Search API key not found in keychain')

      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`
      // No `Accept-Encoding` of our own. Each platform negotiates compression itself and
      // undoes it itself; a header set by hand made Android's native HTTP hand the body over
      // still gzipped, and `response.json` failed on it with «Unexpected token» while iOS and
      // the desktop, which always decompress, were fine (2026-09-05).
      const response = await requestUrl({
        url,
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      })

      const results = (response.json.web?.results || [])
        .slice(0, count)
        .map(
          (r: { title: string; url: string; description: string }, i: number) =>
            `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`
        )

      return {
        content: [
          { type: 'text', text: results.length ? results.join('\n\n') : 'No results found.' },
        ],
      }
    },
  }
}
