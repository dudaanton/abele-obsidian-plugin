/**
 * The request `web_search` sends to Brave.
 *
 * It used to ask for gzip by hand. Every platform negotiates compression on its own and undoes
 * it on its own — unless the header was set by the caller, in which case Android's native
 * HTTP hands the body over still compressed, and the tool failed there with «Unexpected token»
 * while iOS and the desktop were fine (2026-09-05, from an Android phone).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createWebSearchTool } from '@/ai/tools/WebSearchTool'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }))

vi.mock('obsidian', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../mocks/obsidian')),
  requestUrl,
}))

beforeEach(() => {
  const app = useVault([])
  app.secretStorage.setSecret('brave-key', 'brave-test-key')
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, braveSearchApiKey: 'brave-key' }
  requestUrl.mockReset()
  requestUrl.mockResolvedValue({
    status: 200,
    json: {
      web: { results: [{ title: 'Weather', url: 'https://w.example', description: 'Rain' }] },
    },
  })
})

describe('the request to Brave', () => {
  it('leaves compression to the platform rather than asking for gzip itself', async () => {
    await createWebSearchTool().execute('1', { query: 'погода Санкт-Петербург' })

    const headers = requestUrl.mock.calls[0][0].headers as Record<string, string>
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('accept-encoding')
    expect(headers['X-Subscription-Token']).toBe('brave-test-key')
    expect(headers.Accept).toBe('application/json')
  })

  it('carries the query and returns the results it was given', async () => {
    const result = await createWebSearchTool().execute('2', { query: 'погода', count: 3 })

    const url = requestUrl.mock.calls[0][0].url as string
    expect(url).toContain(`q=${encodeURIComponent('погода')}`)
    expect(url).toContain('count=3')
    expect(result.content[0].text).toContain('Weather')
    expect(result.content[0].text).toContain('https://w.example')
  })
})
