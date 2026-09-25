/**
 * The list of keys, and the keys it shows, are the person's and never an agent's.
 *
 * Two halves. What an agent can already reach — the settings tools — returns no value and no
 * listing however it is asked. And nothing an agent runs can reach the list at all: no module
 * under the agent's tools, the scripting runtime or the reference it reads imports the list,
 * its catalogue or its clipboard.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createAgentTools } from '@/ai/tools'
import { createReadSettingsTool } from '@/ai/tools/SettingsTools'
import { AbeleConfig, DEFAULT_SETTINGS } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const FAKE = {
  'abele-provider-p': 'fake-provider-value-1',
  'abele-secret-1': 'fake-stored-value-2',
  'abele-github-token': 'fake-github-value-3',
}

let app: FakeApp

beforeEach(() => {
  app = useVault([])
  for (const [id, value] of Object.entries(FAKE)) app.secretStorage.setSecret(id, value)
  const config = AbeleConfig.getInstance()
  config.applySettings(undefined)
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    secrets: [{ name: 'Weather', keyId: 'abele-secret-1' }],
    providers: [
      { id: 'p', name: 'OpenAI', baseUrl: 'http://x', apiKeyId: 'abele-provider-p', models: [] },
    ],
  }
})

async function answer(path?: string): Promise<string> {
  const result = await createReadSettingsTool().execute('call', path ? { path } : {})
  return result.content.map((part) => ('text' in part ? part.text : '')).join('')
}

describe('the settings tools', () => {
  it('return no key value by any root, listed or asked for', async () => {
    const roots = [
      ...Object.keys(DEFAULT_SETTINGS),
      ...Object.keys(DEFAULT_AI_SETTINGS).map((k) => `ai.${k}`),
      'secretStore',
    ]
    const texts = [await answer(), ...(await Promise.all(roots.map((r) => answer(r))))]
    const all = texts.join('\n')
    for (const value of Object.values(FAKE)) expect(all).not.toContain(value)
  })

  it('offer no tool that lists, shows or copies keys', () => {
    const names = createAgentTools().map((tool) => tool.name)
    expect(names.filter((name) => /secret|keychain|clipboard/i.test(name))).toEqual([])
  })
})

describe('what an agent runs', () => {
  const SRC = join(__dirname, '..', '..', 'src')
  const AGENT_SIDE = ['ai', 'scripting', 'docs', 'automations'].map((dir) => join(SRC, dir))
  const PRIVATE = /secrets\/catalog|secrets\/clipboard|SecretsListModal/

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return walk(path)
      return /\.(ts|vue|md)$/.test(path) ? [path] : []
    })

  it('never imports the list of keys, its catalogue or its clipboard', () => {
    const offenders = AGENT_SIDE.flatMap(walk)
      .filter((path) => PRIVATE.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path))
    expect(offenders).toEqual([])
  })
})
