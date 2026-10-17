import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import GithubSettings from '@/components/settings/GithubSettings.vue'
import Editor from '@/components/settings/GithubConnectionEditor.vue'
import Button from '@/components/obsidian/Button.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { useVault } from '../helpers/testEnv'
import Setting from '@/components/obsidian/Setting.vue'

beforeEach(() => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.github = githubSettingsFrom({ enabled: true })
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
})

describe('connection settings list', () => {
  it.each(['forgejo', 'gitea', 'gitlab', 'future-forge'])(
    'keeps an imported %s connection removable without a GitHub client',
    async (provider) => {
      const app = useVault([]),
        config = AbeleConfig.getInstance()
      const github = {
        id: 'github',
        name: 'Sample GitHub',
        server: '',
        keyId: 'github-slot',
        owners: [],
        isDefault: true,
      }
      const foreign = {
        ...github,
        id: 'foreign',
        name: 'Sample other service',
        provider,
        server: 'https://git.example.test/team',
        keyId: 'foreign-slot',
      }
      config.github = githubSettingsFrom({ enabled: true, connections: [github, foreign] })
      const read = vi.spyOn(app.secretStorage, 'getSecret')
      const view = mount(GithubSettings)
      const row = view
        .findAllComponents(Setting)
        .find((row) => String(row.props('name')).startsWith(foreign.name))!
      expect(row.text()).toMatch(/available in a later version/i)
      expect(row.findAllComponents(Button).map((button) => button.props('text'))).toEqual([
        'Delete',
      ])
      expect(read.mock.calls.some(([id]) => id === foreign.keyId)).toBe(false)
      expect(
        view
          .findAllComponents(Setting)
          .find((row) => String(row.props('name')).startsWith(github.name))!
          .text()
      ).toContain('Edit')
      row.findComponent(Button).vm.$emit('click')
      await flushPromises()
      view.findComponent(ConfirmModal).vm.$emit('confirm')
      await flushPromises()
      expect(config.github.connections.map((c) => c.id)).toEqual(['github'])
      view.unmount()
    }
  )

  it('does not clear another provider default when a GitHub connection is saved on the same host', async () => {
    const config = AbeleConfig.getInstance()
    const github = {
      id: 'github',
      name: 'Sample GitHub',
      server: 'https://git.example.test',
      keyId: 'github-slot',
      owners: [],
      isDefault: true,
    }
    const foreign = {
      ...github,
      id: 'foreign',
      provider: 'forgejo',
      name: 'Sample Forgejo',
      keyId: 'foreign-slot',
    }
    config.github = githubSettingsFrom({ enabled: true, connections: [github, foreign] })
    const view = mount(GithubSettings)
    view
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Edit')!
      .vm.$emit('click')
    await flushPromises()
    view.findComponent(Editor).vm.$emit('save', { ...github, name: 'Updated GitHub' })
    await flushPromises()
    expect(config.github.connections.find((c) => c.id === 'foreign')?.isDefault).toBe(true)
    view.unmount()
  })
  it('does not forget a slot still used by the notifications credential when its connection is deleted', async () => {
    const app = useVault([]),
      config = AbeleConfig.getInstance()
    config.github = githubSettingsFrom({
      enabled: true,
      keyId: 'shared-classic',
      notifications: { keyId: 'shared-classic' },
    })
    app.secretStorage.setSecret('shared-classic', 'invented-classic')
    const view = mount(GithubSettings)
    view
      .findAllComponents(Button)
      .find((b) => b.props('text') === 'Delete')!
      .vm.$emit('click')
    await flushPromises()
    view.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()
    expect(config.github.connections).toEqual([])
    expect(app.secretStorage.getSecret('shared-classic')).toBe('invented-classic')
    view.unmount()
  })

  it('adds a connection with its own valid keychain slot, without changing settings on cancel', async () => {
    const app = useVault([])
    const view = mount(GithubSettings)
    const add = () =>
      view
        .findAllComponents(Button)
        .find((b) => b.props('text') === 'Add connection')!
        .vm.$emit('click')
    add()
    await flushPromises()
    view.findComponent(Editor).vm.$emit('close')
    await flushPromises()
    expect(AbeleConfig.getInstance().github.connections).toEqual([])
    add()
    await flushPromises()
    const editor = view.findComponent(Editor)
    const draft = {
      ...editor.props('connection'),
      name: 'Sample',
      owners: ['sample-org'],
      isDefault: true,
    }
    editor.vm.$emit('save', draft, 'invented-token')
    await flushPromises()
    const connection = AbeleConfig.getInstance().github.connections[0]
    expect(connection.name).toBe('Sample')
    expect(connection.keyId).toMatch(/^[a-z0-9-]{1,64}$/)
    expect(app.secretStorage.getSecret(connection.keyId)).toBe('invented-token')
    expect(view.text()).not.toContain('invented-token')
    view.unmount()
  })

  it('a keychain failure cannot leave a connection pointing at an unsaved token', async () => {
    const app = useVault([])
    vi.spyOn(app.secretStorage, 'setSecret').mockImplementation(() => {
      throw new Error('unavailable')
    })
    const view = mount(GithubSettings)
    view
      .findAllComponents(Button)
      .find((b) => b.props('text') === 'Add connection')!
      .vm.$emit('click')
    await flushPromises()
    const editor = view.findComponent(Editor)
    editor.vm.$emit('save', { ...editor.props('connection'), name: 'Sample' }, 'invented-token')
    await flushPromises()
    expect(AbeleConfig.getInstance().github.connections).toEqual([])
    expect(view.text()).toMatch(/could not save/i)
    expect(view.findComponent(Editor).exists()).toBe(true)
    view.unmount()
  })
})
