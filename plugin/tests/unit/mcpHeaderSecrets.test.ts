import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AbeleConfig, type AbeleSettings } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { createMcpServer, type McpServer } from '@/ai/mcp/types'
import { McpService } from '@/ai/mcp/McpService'
import {
  createReadSettingsTool,
  createWriteSettingsTool,
  describeSettingsWrite,
} from '@/ai/tools/SettingsTools'
import { restoreHidden } from '@/ai/tools/settingsPaths'
import { moveLegacySecrets } from '@/secrets/legacy'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import {
  initializeDestinations,
  keyDestinations,
  checkRequestDestinations,
  acceptDestinations,
} from '@/secrets/destinations'
import { allowHttpOrigin } from '@/secrets/keyTransport'
import {
  collectEntries,
  buildPayload,
  needsCode,
  arrivingSecretIds,
  applyEntries,
} from '@/transfer/entries'
import { storeReceivedKeys } from '@/transfer/receivedKeys'
import { decodePayload, encodePayload, isEncrypted } from '@/transfer/payload'
import { useVault } from '../helpers/testEnv'

const RAW = {
  Authorization: 'Basic invented-basic-credential',
  'x-API-key': 'invented-api-credential',
  Cookie: 'session=invented-cookie-credential',
  'Proxy-Authorization': 'Bearer invented-proxy-credential',
  'X-Access-Token': 'invented-access-credential',
  'Ocp-Apim-Subscription-Key': 'invented-subscription-credential',
}
const sample = () =>
  createMcpServer({
    id: 'sample',
    name: 'Sample',
    url: 'https://mcp.example.test/mcp',
    headers: { ...RAW, 'X-Team': 'blue', 'X-Empty': '' },
  })
const config = () => AbeleConfig.getInstance()
const server = () => config().ai.mcpServers![0]
const entries = () =>
  collectEntries({ ai: config().ai } as AbeleSettings).filter(
    (entry) => entry.section === 'ai-mcp-servers'
  )
const headerId = (value: string) => {
  const match = /^\$\{abele_mcp_key:([a-z0-9-]+)\}$/.exec(value)
  expect(match, 'a credential header must hold only a keychain reference').not.toBeNull()
  return match![1]
}

beforeEach(() => {
  useVault([])
  setSecrets(null)
  config().fireflyToken = ''
  config().ai = { ...DEFAULT_AI_SETTINGS, mcpServers: [sample()] }
})
afterEach(() => {
  setSecrets(null)
  vi.restoreAllMocks()
})

describe('MCP credential headers', () => {
  it('does not treat tool permission names containing token as credential headers', async () => {
    config().ai.toolModes = { mcp_sample_get_token: 'ask' }
    const result = await createReadSettingsTool().execute('sample', {
      path: 'ai.toolModes.mcp_sample_get_token',
    })
    expect(JSON.stringify(result)).toContain('ask')
  })

  it('masks padded header names and preserves masked values when ordinary headers are updated', async () => {
    server().headers = { ' Authorization ': RAW.Authorization, 'X-Team': 'blue' }
    const result = await createReadSettingsTool().execute('sample', {
      path: 'ai.mcpServers.sample.headers',
    })
    expect(JSON.stringify(result)).not.toContain(RAW.Authorization)
    vi.spyOn(config(), 'saveSettings').mockResolvedValue()
    const updated = await createWriteSettingsTool().execute('sample', {
      path: 'ai.mcpServers.sample.headers',
      op: 'update',
      value: JSON.stringify({ ' Authorization ': '<hidden>', 'X-Team': 'green' }),
    })
    expect(JSON.stringify(updated)).not.toContain(RAW.Authorization)
    expect(server().headers).toEqual({ ' Authorization ': RAW.Authorization, 'X-Team': 'green' })
  })

  it('moves existing credentials once, keeps ordinary headers, and sends the original values', () => {
    expect(moveLegacySecrets(config())).toBe(true)
    const first = JSON.stringify(server())
    for (const [name, value] of Object.entries(RAW)) {
      const id = headerId(server().headers[name])
      expect(id.length).toBeLessThanOrEqual(64)
      expect(secrets().get(id)).toBe(value)
      expect(first).not.toContain(value)
      expect(keyDestinations(config())).toContainEqual({
        keyId: id,
        name: 'Sample',
        origin: 'https://mcp.example.test',
      })
    }
    expect(server().headers['X-Team']).toBe('blue')
    expect(server().headers['X-Empty']).toBe('')
    expect(moveLegacySecrets(config())).toBe(false)
    expect(JSON.stringify(server())).toBe(first)
    expect(new McpService().headersFor(server())).toEqual(sample().headers)
  })

  it('retains a credential if the keychain refuses it, while agent reads and exports still hide it', async () => {
    vi.spyOn(secrets(), 'set').mockImplementation(() => {
      throw new Error('invented keychain failure')
    })
    expect(moveLegacySecrets(config())).toBe(false)
    expect(server().headers).toEqual(sample().headers)
    const result = await createReadSettingsTool().execute('sample', {
      path: 'ai.mcpServers.sample',
    })
    const text = JSON.stringify(result)
    for (const value of Object.values(RAW)) {
      expect(text).not.toContain(value)
      expect(JSON.stringify(buildPayload(entries(), null))).not.toContain(value)
    }
  })

  it('hides unmigrated credentials at every read depth and in write previews without hiding ordinary headers', async () => {
    for (const path of [
      'ai.mcpServers',
      'ai.mcpServers.sample',
      'ai.mcpServers.sample.headers',
      ...Object.keys(RAW).map((name) => `ai.mcpServers.sample.headers.${name}`),
    ]) {
      const result = await createReadSettingsTool().execute('sample', { path })
      for (const value of Object.values(RAW)) expect(JSON.stringify(result)).not.toContain(value)
    }
    const result = await createReadSettingsTool().execute('sample', {
      path: 'ai.mcpServers.sample.headers.X-Team',
    })
    expect(JSON.stringify(result)).toContain('blue')
    const preview = describeSettingsWrite(
      'ai.mcpServers.sample.headers',
      JSON.stringify(sample().headers)
    )
    for (const value of Object.values(RAW)) expect(JSON.stringify(preview)).not.toContain(value)
    expect(
      restoreHidden({ headers: { Authorization: '<hidden>', 'X-Team': 'green' } }, sample())
    ).toMatchObject({ headers: { Authorization: RAW.Authorization, 'X-Team': 'green' } })
  })

  it('exports old raw headers without credentials when keys are excluded, without mutating settings', () => {
    const before = JSON.stringify(server())
    const payload = buildPayload(entries(), null)
    for (const value of Object.values(RAW)) expect(JSON.stringify(payload)).not.toContain(value)
    expect((payload.entries[0].data as McpServer).headers['X-Team']).toBe('blue')
    expect(payload.secrets).toEqual({})
    expect(needsCode(payload)).toBe(false)
    expect(JSON.stringify(server())).toBe(before)
  })

  it('carries migrated header keys through secretsOf and an encrypted transfer, and restores them on receipt', async () => {
    expect(moveLegacySecrets(config())).toBe(true)
    const payload = buildPayload(entries(), (id) => secrets().get(id))
    expect(Object.values(payload.secrets).sort()).toEqual(Object.values(RAW).sort())
    expect(payload.entries[0].secretIds).toEqual(
      expect.arrayContaining(Object.keys(payload.secrets))
    )
    expect(needsCode(payload)).toBe(true)
    const blob = await encodePayload(payload, 'ABCDEFGH')
    expect(isEncrypted(blob)).toBe(true)
    expect(await decodePayload(blob)).toEqual({ ok: false, reason: 'needs-code' })
    expect(await decodePayload(blob, 'ABCDEFGH')).toEqual({ ok: true, payload })
    const received = applyEntries(payload.entries, { ai: {} } as never)
    expect(arrivingSecretIds(payload.entries, received).sort()).toEqual(
      Object.keys(payload.secrets).sort()
    )
    useVault([])
    setSecrets(null)
    config().ai = { ...DEFAULT_AI_SETTINGS, ...received.ai }
    expect(
      storeReceivedKeys(
        payload.entries,
        payload.secrets,
        arrivingSecretIds(payload.entries, received)
      )
    ).toBe(0)
    expect(new McpService().headersFor(server())).toEqual(sample().headers)
  })

  it('protects old raw headers in an export with keys even before migration', () => {
    const payload = buildPayload(entries(), () => '')
    expect(Object.values(payload.secrets).sort()).toEqual(Object.values(RAW).sort())
    for (const value of Object.values(RAW))
      expect(JSON.stringify(payload.entries)).not.toContain(value)
    expect(needsCode(payload)).toBe(true)
    // The encryption decision is safe even for a legacy entry passed directly by a caller.
    expect(needsCode({ v: 1, at: '', entries: entries(), secrets: {} })).toBe(true)
  })

  it('keeps existing named-key headers working and binds automatic references to their saved address', () => {
    server().headers['X-Named'] = '${abele_key:Sample key}'
    config().ai.secrets = [
      { name: 'Sample key', keyId: 'sample-named', allowedOrigins: ['https://mcp.example.test'] },
    ]
    secrets().set('sample-named', 'invented-named-credential')
    expect(moveLegacySecrets(config())).toBe(true)
    initializeDestinations(config())
    expect(new McpService().headersFor(server())['X-Named']).toBe('invented-named-credential')
    const changed = { ...server(), url: 'https://other.example.test/mcp' }
    expect(() => new McpService().headersFor(changed)).toThrow(/configured/)
  })

  it('keeps an existing installation working when plaintext headers move into fresh keychain slots', () => {
    initializeDestinations(config())
    expect(moveLegacySecrets(config())).toBe(true)
    expect(new McpService().headersFor(server())).toEqual(sample().headers)
  })

  it('persists the startup migration and does not create more slots after reloading the saved file', async () => {
    const saved: AbeleSettings[] = []
    let file: unknown = { ai: { ...DEFAULT_AI_SETTINGS, mcpServers: [sample()] } }
    const plugin = {
      loadData: async () => file,
      saveData: async (data: AbeleSettings) => {
        saved.push(structuredClone(data))
        file = structuredClone(data)
      },
      syncAiFeatures: vi.fn(),
    }
    config().init(plugin as never)
    await config().loadSettings()
    saved.length = 0
    const writeKey = vi.spyOn(secrets(), 'set')
    await config().moveLegacySecrets()
    expect(saved).toHaveLength(1)
    for (const value of Object.values(RAW)) expect(JSON.stringify(saved)).not.toContain(value)
    const migrated = JSON.stringify(server().headers)
    expect(writeKey).toHaveBeenCalledTimes(Object.keys(RAW).length)
    config().init(plugin as never)
    await config().loadSettings()
    await config().moveLegacySecrets()
    expect(saved).toHaveLength(1)
    expect(writeKey).toHaveBeenCalledTimes(Object.keys(RAW).length)
    expect(JSON.stringify(server().headers)).toBe(migrated)
  })

  it('keeps pure named-key credential headers in their existing form', () => {
    server().headers = {
      Authorization: 'Bearer ${abele_key:Sample key}',
      'X-Api-Key': '${abele_key:Sample key}',
      'X-Team': 'blue',
    }
    expect(moveLegacySecrets(config())).toBe(false)
    expect(server().headers.Authorization).toBe('Bearer ${abele_key:Sample key}')
  })

  it('refuses to send a transferred reference until its recipient is confirmed locally', () => {
    moveLegacySecrets(config())
    const payload = buildPayload(entries(), (id) => secrets().get(id))
    useVault([])
    setSecrets(null)
    config().ai = { ...DEFAULT_AI_SETTINGS, mcpServers: [] }
    initializeDestinations(config())
    config().ai.mcpServers = [payload.entries[0].data as McpServer]
    storeReceivedKeys(payload.entries, payload.secrets, arrivingSecretIds(payload.entries))
    expect(moveLegacySecrets(config())).toBe(false)
    expect(() => new McpService().headersFor(server())).toThrow(/Confirm/)
    acceptDestinations(keyDestinations(config()))
    expect(new McpService().headersFor(server())).toEqual(sample().headers)
  })

  it('recognizes a complete saved Basic header for an explicitly allowed home-network server', () => {
    server().url = 'http://192.168.1.5/mcp'
    server().headers = { Authorization: 'Basic c2FtcGxlOmludmVudGVkLXBhc3N3b3Jk' }
    moveLegacySecrets(config())
    allowHttpOrigin(server().url)
    const headers = new McpService().headersFor(server())
    expect(() => checkRequestDestinations({ url: server().url, headers }, config())).not.toThrow()
  })
})
