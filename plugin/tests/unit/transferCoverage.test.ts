import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { AbeleConfig, DEFAULT_SETTINGS, type AbeleSettings } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'
import { collectEntries, buildPayload, planEntries, applyEntries } from '@/transfer/entries'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'

it('persists migrated identities and keeps aliases of one slot distinct', async () => {
  useVault([])
  const disk = new FakeSettings({
    refreshDelay: 500,
    ai: {
      ...DEFAULT_AI_SETTINGS,
      secrets: [
        { name: 'Sample alpha', keyId: 'sample-shared-key' },
        { name: 'Sample beta', keyId: 'sample-shared-key' },
      ],
    },
  })
  const config = AbeleConfig.getInstance()
  config.init(disk as never)
  try {
    await config.loadSettings()
    const ids = config.ai.secrets.map((key) => key.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    config.ai.secrets[0].name = 'Sample renamed'
    await config.saveSettings()
    await config.reloadSettings()
    expect(config.ai.secrets.map((key) => key.id)).toEqual(ids)
    expect(config.ai.secrets.map((key) => key.keyId)).toEqual([
      'sample-shared-key',
      'sample-shared-key',
    ])
  } finally {
    config.destroy()
  }
})

// Explicit transport exclusions, not accidental omissions from a section's named fields.
const localOrManaged = {
  root: {
    keyboardDiagnostics: 'Device-specific keyboard diagnostics panel.',
    fireflyToken:
      'Retired plaintext input migrated into the local keychain; the selected key travels separately.',
    secretStore:
      'Managed encrypted store, never replaced by settings transfer; selected key values travel separately.',
  },
  ai: {
    chatHistory: 'Vault-local index of conversation paths, rebuilt where those files live.',
    openRouterApiKey: 'Retired plaintext input migrated into image provider keychain references.',
    imageModel: 'Retired model selection migrated into imageProviders.',
    imageGeneration: 'Retired generator configuration migrated into imageProviders.',
  },
}

function fields(file: string, name: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(resolve(process.cwd(), file), 'utf8'),
    ts.ScriptTarget.Latest
  )
  const declaration = source.statements.find(
    (node) => ts.isInterfaceDeclaration(node) && node.name.text === name
  ) as ts.InterfaceDeclaration
  return declaration.members
    .filter(ts.isPropertySignature)
    .map((member) => member.name.getText(source).replace(/^['"]|['"]$/g, ''))
}

it('accounts for every declared root and AI setting in transfer sections or explicit local policy', () => {
  const root = new Set<string>()
  const ai = new Set<string>()
  const agentSettings = new Proxy(
    {
      ...DEFAULT_AI_SETTINGS,
      ...Object.fromEntries(
        fields('src/ai/types.ts', 'AiSettings').map((key) => [
          key,
          (DEFAULT_AI_SETTINGS as unknown as Record<string, unknown>)[key],
        ])
      ),
    },
    {
      get(target, key) {
        if (typeof key === 'string') ai.add(key)
        return Reflect.get(target, key)
      },
    }
  )
  const settings = new Proxy(
    {
      ...DEFAULT_SETTINGS,
      ...Object.fromEntries(
        fields('src/services/AbeleConfig.ts', 'AbeleSettings').map((key) => [
          key,
          (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key],
        ])
      ),
      ai: agentSettings,
    },
    {
      get(target, key) {
        if (typeof key === 'string') root.add(key)
        return Reflect.get(target, key)
      },
    }
  )
  collectEntries(settings)
  for (const [declared, offered, exclusions] of [
    [fields('src/services/AbeleConfig.ts', 'AbeleSettings'), root, localOrManaged.root],
    [fields('src/ai/types.ts', 'AiSettings'), ai, localOrManaged.ai],
  ] as const) {
    expect(declared.filter((key) => !offered.has(key) && !(key in exclusions))).toEqual([])
    for (const [key, reason] of Object.entries(exclusions)) {
      expect(declared).toContain(key)
      expect(reason.length).toBeGreaterThan(10)
      expect(offered.has(key)).toBe(false)
    }
  }
})

it('round-trips distinct legacy saved keys without collapsing them into one record', () => {
  const source = {
    refreshDelay: 500,
    ai: {
      ...DEFAULT_AI_SETTINGS,
      secrets: [
        { name: 'Sample alpha', keyId: 'sample-alpha-key' },
        { name: 'Sample beta', keyId: 'sample-beta-key' },
      ],
    },
  } as AbeleSettings
  const entries = collectEntries(source).filter((entry) => entry.section === 'ai-secrets')
  expect(entries.map((entry) => typeof entry.id)).toEqual(['string', 'string'])
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(2)
  const payload = JSON.parse(JSON.stringify(buildPayload(entries, (id) => `${id}-value`)))
  const target = { refreshDelay: 500, ai: { ...DEFAULT_AI_SETTINGS, secrets: [] } } as AbeleSettings
  expect(planEntries(payload.entries, target).map((entry) => entry.status)).toEqual(['new', 'new'])
  const received = applyEntries(payload.entries, target)
  expect(received.ai!.secrets.map((secret) => secret.keyId)).toEqual([
    'sample-alpha-key',
    'sample-beta-key',
  ])
  expect(payload.secrets).toEqual({
    'sample-alpha-key': 'sample-alpha-key-value',
    'sample-beta-key': 'sample-beta-key-value',
  })
  expect(
    collectEntries(source)
      .filter((entry) => entry.section === 'ai-secrets')
      .map((entry) => entry.id)
  ).toEqual(entries.map((entry) => entry.id))
})

it('round-trips the chat auto-retry configuration in AI general settings', () => {
  const source = {
    refreshDelay: 500,
    ai: { ...DEFAULT_AI_SETTINGS, autoRetry: { attempts: 4, firstDelayMs: 1200 } },
  } as AbeleSettings
  const entry = collectEntries(source).find((item) => item.section === 'ai-general')!
  expect(entry.data).toMatchObject({ autoRetry: { attempts: 4, firstDelayMs: 1200 } })
  const target = {
    refreshDelay: 500,
    ai: { ...DEFAULT_AI_SETTINGS, autoRetry: { attempts: 0, firstDelayMs: 100 } },
  } as AbeleSettings
  expect(applyEntries([entry], target).ai!.autoRetry).toEqual(source.ai!.autoRetry)
})
