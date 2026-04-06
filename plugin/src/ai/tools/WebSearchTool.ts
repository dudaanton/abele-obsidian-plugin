import type { AgentTool } from '../client'
import { AbeleConfig } from '@/services/AbeleConfig'
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
      const count = Math.min((params.count as number) || 5, 20)
      const apiKey = AbeleConfig.getInstance().ai.braveSearchApiKey

      if (!apiKey) throw new Error('Brave Search API key is not configured in settings')

      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`
      const response = await requestUrl({
        url,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
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
