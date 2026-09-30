/**
 * The separate token for GitHub notifications: an optional classic token, kept in the keychain
 * like the main one and used by the notifications panel alone. Without it the panel reads with
 * the main token, and a refusal names the field where the classic one goes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import GithubSettings from '@/components/settings/GithubSettings.vue'
import SecretField from '@/components/settings/SecretField.vue'
import Button from '@/components/obsidian/Button.vue'
import Input from '@/components/obsidian/Input.vue'
import ConnectionEditor from '@/components/settings/GithubConnectionEditor.vue'
import Icon from '@/components/obsidian/Icon.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  DEFAULT_GITHUB_SETTINGS,
  GITHUB_NOTIFICATIONS_TOKEN_KEY_ID,
  GITHUB_TOKEN_KEY_ID,
  githubSettingsFrom,
} from '@/github/settings'
import { githubClient, notificationsClient, resetGithubClients } from '@/github/GithubService'
import { GithubError } from '@/github/client'
import { notificationsRefusal } from '@/github/notifications/inbox'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp

const tokenOf = (client: unknown) => (client as { token: string }).token

beforeEach(() => {
  app = useVault([])
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  AbeleConfig.getInstance().github = githubSettingsFrom({
    enabled: true,
    keyId: GITHUB_TOKEN_KEY_ID,
  })
  app.secretStorage.setSecret(GITHUB_TOKEN_KEY_ID, 'github_pat_main')
  resetGithubClients()
})

afterEach(() => vi.restoreAllMocks())

describe('the notifications token setting', () => {
  it('is empty by default, and a settings file without it reads as empty', () => {
    expect(DEFAULT_GITHUB_SETTINGS.notifications).toEqual({ keyId: '' })
    expect(githubSettingsFrom({ enabled: true }).notifications).toEqual({ keyId: '' })
    expect(githubSettingsFrom({ notifications: 'nonsense' } as never).notifications).toEqual({
      keyId: '',
    })
  })

  it('editing the legacy token updates the migrated connection rather than losing the saved key', async () => {
    AbeleConfig.getInstance().github = githubSettingsFrom({
      keyId: 'custom-slot',
      enabled: true,
    })
    const view = mount(GithubSettings)
    view
      .findAllComponents(Button)
      .find((b) => b.props('text') === 'Edit')!
      .vm.$emit('click')
    await flushPromises()
    const editor = view.findComponent(ConnectionEditor)
    const field = editor
      .findAllComponents(Input)
      .find((f) => f.props('placeholder') === 'github_pat_...')!
    field.vm.$emit('update:model-value', 'github_pat_new')
    await flushPromises()
    editor
      .findAllComponents(Button)
      .find((b) => b.props('text') === 'Save')!
      .vm.$emit('click')
    await flushPromises()
    expect(AbeleConfig.getInstance().github.connections[0].keyId).toBe('custom-slot')
    expect(app.secretStorage.getSecret('custom-slot')).toBe('github_pat_new')
    view.unmount()
  })

  it('is saved into the keychain under its own id, and forgotten from there', async () => {
    const view = mount(GithubSettings)
    const field = view
      .findAllComponents(SecretField)
      .find((f) => f.props('placeholder') === 'ghp_...')!
    expect(field).toBeDefined()
    field.vm.$emit('update:model-value', 'ghp_classic_one')
    await flushPromises()
    field.vm.$emit('save')
    await flushPromises()

    const config = AbeleConfig.getInstance()
    expect(config.github?.notifications).toEqual({
      keyId: GITHUB_NOTIFICATIONS_TOKEN_KEY_ID,
      boundKeyId: GITHUB_NOTIFICATIONS_TOKEN_KEY_ID,
      boundServer: '',
    })
    expect(app.secretStorage.getSecret(GITHUB_NOTIFICATIONS_TOKEN_KEY_ID)).toBe('ghp_classic_one')
    // The main token is left as it was.
    expect(config.github?.keyId).toBe(GITHUB_TOKEN_KEY_ID)
    expect(app.secretStorage.getSecret(GITHUB_TOKEN_KEY_ID)).toBe('github_pat_main')

    const forget = view
      .findAllComponents(Icon)
      .find((i) => i.props('tooltip') === 'Forget the notifications token')!
    await forget.trigger('click')
    await flushPromises()
    const confirm = view
      .findAllComponents(ConfirmModal)
      .find((m) => m.props('title') === 'Forget the notifications token')!
    confirm.vm.$emit('confirm')
    await flushPromises()
    expect(config.github?.notifications).toEqual({ keyId: '' })
    expect(app.secretStorage.getSecret(GITHUB_NOTIFICATIONS_TOKEN_KEY_ID)).toBe('')
    expect(config.github?.keyId).toBe(GITHUB_TOKEN_KEY_ID)
  })
})

describe('the Access section', () => {
  it('says the notifications need a classic token of their own', () => {
    const view = mount(GithubSettings)
    const access = view
      .findAll('.setting-item-description, .abele-section__desc, p, div')
      .map((e) => e.text())
      .find((t) => t.startsWith('A fine-grained personal access token'))
    expect(access).toMatch(/classic token with the notifications scope/)
    expect(access).toContain('Notifications token')
  })
})

describe('which token the notifications are read with', () => {
  it('keeps its server when the main connection moves to another host', () => {
    const config = AbeleConfig.getInstance()
    config.github = githubSettingsFrom({
      server: 'http://git.example.test:8080',
      keyId: GITHUB_TOKEN_KEY_ID,
      notifications: { keyId: GITHUB_NOTIFICATIONS_TOKEN_KEY_ID },
    })
    app.secretStorage.setSecret(GITHUB_NOTIFICATIONS_TOKEN_KEY_ID, 'ghp_classic_one')
    config.github = { ...config.github, server: '' }
    const { client } = notificationsClient()
    expect(client.endpoints.api).toBe('http://git.example.test:8080/api/v3')
    expect(tokenOf(client)).toBe('ghp_classic_one')
  })

  it('the notifications token when one is set, and only for them', () => {
    AbeleConfig.getInstance().github = {
      ...AbeleConfig.getInstance().github!,
      notifications: { keyId: GITHUB_NOTIFICATIONS_TOKEN_KEY_ID },
    }
    app.secretStorage.setSecret(GITHUB_NOTIFICATIONS_TOKEN_KEY_ID, 'ghp_classic_one')
    const { client, separate } = notificationsClient()
    expect(tokenOf(client)).toBe('ghp_classic_one')
    expect(separate).toBe(true)
    expect(tokenOf(githubClient())).toBe('github_pat_main')
  })

  it('the main token when none is set, or when its keychain slot is empty here', () => {
    const none = notificationsClient()
    expect(tokenOf(none.client)).toBe('github_pat_main')
    expect(none.separate).toBe(false)

    AbeleConfig.getInstance().github = {
      ...AbeleConfig.getInstance().github!,
      notifications: { keyId: GITHUB_NOTIFICATIONS_TOKEN_KEY_ID },
    }
    const empty = notificationsClient()
    expect(tokenOf(empty.client)).toBe('github_pat_main')
    expect(empty.separate).toBe(false)
  })
})

describe('what a refusal says about the field', () => {
  const refused = () =>
    new GithubError('forbidden', 'x', 403, {
      kind: 'forbidden',
      reason: 'x',
      githubSaid: 'Resource not accessible by personal access token',
    })

  it('sends a refused main token to the notifications token field', () => {
    const e = notificationsRefusal(refused(), 'fine-grained', {}, false)
    expect(e.message).toContain('Notifications token')
    expect(e.message).toContain('Abele settings → GitHub')
    expect(e.message).toMatch(/everything else keeps (using|the) (the )?main token/i)
  })

  it('names the notifications token itself when that is what was refused', () => {
    const e = notificationsRefusal(refused(), 'fine-grained', {}, true)
    expect(e.message).toMatch(/The notifications token is a fine-grained one/)
    const bad = notificationsRefusal(
      new GithubError('auth', 'x', 401, { kind: 'auth', reason: 'x' }),
      'classic',
      {},
      true
    )
    expect(bad.message).toMatch(/did not accept the notifications token/)
    expect(bad.message).toContain('Notifications token')
  })
})
