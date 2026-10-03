import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { initializeDestinations } from '@/secrets/destinations'
import {
  prepareSecretRequest,
  allowSecretOrigin,
  secretRequestInfo,
  needsSecretApproval,
} from '@/ai/tools/secretUtils'
import { ChatSession } from '@/ai/ChatSession'
import { createMcpServer } from '@/ai/mcp/types'
import { ChatService } from '@/ai/ChatService'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

beforeEach(() => {
  const app = useVault([])
  app.secretStorage.setSecret('sample-key', 'sample-secret-value')
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    secrets: [{ name: 'sample', keyId: 'sample-key' }],
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue()
  initializeDestinations(AbeleConfig.getInstance())
})
destroyChatsAfterEach()
const req = {
  url: 'https://api.sample.example/data',
  headers: { 'X-Custom': '${abele_key:sample}' },
}

describe('saved-key request destinations', () => {
  it('holds a named key until its allowed-address list includes the recipient', async () => {
    expect(() => prepareSecretRequest(req)).toThrow(/allowed|configured/i)
    await allowSecretOrigin('sample', req.url)
    const prepared = prepareSecretRequest(req)
    expect(prepared.headers['X-Custom']).toBe('sample-secret-value')
    expect(prepared.secretValues).toEqual(['sample-secret-value'])
    expect(() => prepareSecretRequest({ ...req, url: 'https://other.example/' })).toThrow()
  })
  it('cannot use a placeholder to choose the authority or reveal a key in the approval summary', () => {
    expect(() =>
      secretRequestInfo({ ...req, url: 'https://${abele_key:sample}.example/' })
    ).toThrow()
    expect(JSON.stringify(secretRequestInfo(req))).not.toContain('sample-secret-value')
  })
  it('still holds an allowed address that arrived from elsewhere', () => {
    AbeleConfig.getInstance().ai.secrets[0].allowedOrigins = ['https://api.sample.example']
    expect(() => prepareSecretRequest(req)).toThrow(/confirm|review/i)
    expect(needsSecretApproval('fetch', req)).toBe(true)
  })
  it.each(['fetch', 'download_image', 'download_file'])(
    'remembers an allowed origin for %s across paths, query strings and equivalent URLs',
    async (tool) => {
      await allowSecretOrigin('sample', 'https://API.SAMPLE.EXAMPLE:443/first')
      expect(
        needsSecretApproval(tool, { ...req, url: 'https://api.sample.example/next?q=2' })
      ).toBe(false)
      expect(needsSecretApproval(tool, { ...req, url: 'https://api.sample.example/' })).toBe(false)
      expect(
        needsSecretApproval(tool, { ...req, url: 'https://api.sample.example:8443/next' })
      ).toBe(true)
      expect(needsSecretApproval(tool, { ...req, url: 'https://other.example/next' })).toBe(true)
      AbeleConfig.getInstance().ai.secrets.push({ name: 'other', keyId: 'other-key' })
      expect(needsSecretApproval(tool, { ...req, body: '${abele_key:other}' })).toBe(true)
    }
  )
  it('requires confirmation for an unapproved saved-key request, not ordinary local requests', () => {
    expect(needsSecretApproval('fetch', req)).toBe(true)
    expect(
      needsSecretApproval('download_file', { url: req.url, body: '${abele_key:sample}' })
    ).toBe(true)
    expect(needsSecretApproval('fetch', { url: 'http://localhost/api' })).toBe(false)
  })
  it('also asks when an MCP server substitutes a named key in its configured headers', async () => {
    AbeleConfig.getInstance().ai.mcpServers = [
      createMcpServer({
        name: 'Sample',
        url: req.url,
        headers: req.headers,
        tools: [{ name: 'read', description: '', inputSchema: {} }],
      }),
    ]
    expect(needsSecretApproval('mcp_sample_read', {})).toBe(true)
    await allowSecretOrigin('sample', req.url)
    expect(needsSecretApproval('mcp_sample_read', {})).toBe(false)
  })
  it('does not bypass approval for invalid recipients or unknown keys', () => {
    expect(needsSecretApproval('fetch', { ...req, url: 'not-a-url' })).toBe(true)
    expect(
      needsSecretApproval('fetch', { ...req, url: 'https://${abele_key:sample}.example' })
    ).toBe(true)
    expect(needsSecretApproval('fetch', { ...req, body: '${abele_key:missing}' })).toBe(true)
  })
  it('auto mode and interceptor policies cannot suppress an unconfirmed key question', async () => {
    const session = new ChatSession('sample-session', ChatService.getInstance())
    session.permissionMode.value = 'allow-all'
    session.toolModes.value = { fetch: 'auto' }
    expect(session.needsApproval('fetch', req)).toBe(true)
    expect(session.needsApproval('fetch', { url: 'http://localhost/api' })).toBe(false)
    const internal = session as unknown as {
      policyFor(id: string, name: string, args: unknown): Promise<{ kind: string }>
      turnPolicy: { decide: () => Promise<{ kind: string }> }
    }
    vi.spyOn(internal.turnPolicy, 'decide').mockResolvedValue({ kind: 'approve' })
    expect(await internal.policyFor('sample-call', 'fetch', req)).toEqual({ kind: 'ask' })
    await allowSecretOrigin('sample', req.url)
    expect(session.needsApproval('fetch', req)).toBe(false)
    expect(await internal.policyFor('sample-next', 'fetch', req)).toEqual({ kind: 'approve' })
    session.toolModes.value = { fetch: 'ask' }
    expect(session.needsApproval('fetch', req)).toBe(true)
  })
})
