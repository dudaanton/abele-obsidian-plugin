import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { parseForSettings, resolveConnectionCandidates } from '@/github/GithubService'
import { forgejoConnectionSource } from '@/forge/forgejoConnections'
import { OpenPicker } from '@/github/open/OpenPicker'
import { secrets } from '@/secrets/SecretStore'

const rows = [
  {
    id: 'one',
    provider: 'forgejo',
    name: 'Sample one',
    server: 'https://forge.example.test/team',
    keyId: '',
    owners: [],
    isDefault: true,
  },
  {
    id: 'two',
    provider: 'forgejo',
    name: 'Sample two',
    server: 'https://forge.example.test/team',
    keyId: '',
    owners: ['sample'],
    isDefault: false,
  },
]
beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().github = githubSettingsFrom({ enabled: true, connections: rows })
})
describe('Forgejo connection composition', () => {
  it('retires on local key rotation even when the previous token is restored without a settings save', () => {
    const config = AbeleConfig.getInstance()
    config.github.connections[0].keyId = 'sample-clock-key'
    secrets().set('sample-clock-key', 'sample-first')
    const source = forgejoConnectionSource('one', 'sample/project', vi.fn())
    secrets().set('sample-clock-key', 'sample-second')
    secrets().set('sample-clock-key', 'sample-first')
    expect(() => source.assertCurrent()).toThrow(/changed|retired/i)
  })
  it('never revives an old credential generation after a binding is changed back', () => {
    const config = AbeleConfig.getInstance()
    const original = config.github.connections[0].server
    const source = forgejoConnectionSource('one', 'sample/project', vi.fn())
    config.github.connections[0].server = 'https://other.example.test'
    config.version.value++
    config.github.connections[0].server = original
    config.version.value++
    expect(() => source.assertCurrent()).toThrow(/changed|retired/i)
  })
  it('offers a configured Forgejo URL without invoking GitHub search', () => {
    const app = useVault([])
    AbeleConfig.getInstance().github = githubSettingsFrom({ enabled: true, connections: rows })
    const picker = new OpenPicker(app)
    expect(
      picker.getSuggestions('https://forge.example.test/team/sample/project/pulls/12')
    ).toMatchObject([
      { kind: 'pull', url: 'https://forge.example.test/team/sample/project/pulls/12' },
    ])
    picker.onClose()
  })
  it('routes a configured native link by deployment and owner, with explicit choice retained', () => {
    const target = parseForSettings('https://forge.example.test/team/sample/project/pulls/12')!
    expect(target).toMatchObject({ provider: 'forgejo', kind: 'pull' })
    expect(resolveConnectionCandidates(target)[0].id).toBe('two')
    expect(resolveConnectionCandidates(target, { explicitId: 'one' })).toEqual([
      { id: 'one', reason: 'explicit' },
    ])
    expect(parseForSettings('https://forge.example.test/other/sample/project')).toBeNull()
  })
  it('retires readers when a connection is removed or rebound', async () => {
    const source = forgejoConnectionSource('one', 'sample/project', vi.fn())
    AbeleConfig.getInstance().github.connections = rows.filter((r) => r.id !== 'one')
    await expect(source.metadata()).rejects.toThrow(/removed|changed/i)
  })
  it('refuses a missing synced key before transport', async () => {
    AbeleConfig.getInstance().github.connections[0].keyId = 'missing-sample-key'
    const http = vi.fn()
    const source = forgejoConnectionSource('one', 'sample/project', http)
    await expect(source.metadata()).rejects.toThrow(/token.*unavailable/i)
    expect(http).not.toHaveBeenCalled()
  })
})
