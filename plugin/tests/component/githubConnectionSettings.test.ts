import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import GithubSettings from '@/components/settings/GithubSettings.vue'
import Editor from '@/components/settings/GithubConnectionEditor.vue'
import Button from '@/components/obsidian/Button.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.github = githubSettingsFrom({ enabled: true })
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
})

describe('connection settings list', () => {
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
