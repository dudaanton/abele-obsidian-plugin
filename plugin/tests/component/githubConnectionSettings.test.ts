import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import GithubSettings from '@/components/settings/GithubSettings.vue'
import Editor from '@/components/settings/GithubConnectionEditor.vue'
import Button from '@/components/obsidian/Button.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { useVault } from '../helpers/testEnv'
import Setting from '@/components/obsidian/Setting.vue'
import Icon from '@/components/obsidian/Icon.vue'
import StatusDot from '@/components/obsidian/StatusDot.vue'

import { Menu } from 'obsidian'
let openedMenu: Menu
afterEach(() => vi.restoreAllMocks())
const chooseAction = async (view: VueWrapper, title: string) => {
  view
    .findAllComponents(Icon)
    .find((icon) => icon.props('tooltip') === 'Connection actions')!
    .vm.$emit('click', new MouseEvent('click'))
  await flushPromises()
  const item = openedMenu.items.find((item) => item.title === title)
  expect(item).toBeDefined()
  item!.handler!()
  await flushPromises()
}

beforeEach(() => {
  vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockImplementation(function (this: Menu) {
    // Capture the menu instance for exercising its actions without opening a native menu.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Capture the native menu for exercising its actions.
    openedMenu = this
    return this
  })
  useVault([])
  const config = AbeleConfig.getInstance()
  config.github = githubSettingsFrom({ enabled: true })
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
})

describe('connection settings list', () => {
  it('uses the approved compact dot, pencil and action menu instead of stacked row buttons', () => {
    AbeleConfig.getInstance().github = githubSettingsFrom({
      enabled: true,
      connections: [
        {
          id: 'sample',
          provider: 'forgejo',
          name: 'Sample service',
          server: 'https://forge.example.test',
          keyId: '',
          owners: [],
          isDefault: true,
        },
      ],
    })
    const view = mount(GithubSettings)
    const row = view
      .findAllComponents(Setting)
      .find((item) => String(item.props('name')).includes('Sample service'))!
    try {
      expect(row.findAllComponents(Button)).toHaveLength(0)
      expect(row.findComponent(StatusDot).exists()).toBe(true)
      expect(row.findAllComponents(Icon).map((i) => i.props('tooltip'))).toEqual([
        'Edit connection',
        'Connection actions',
      ])
    } finally {
      view.unmount()
    }
  })
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
        .find((row) => String(row.props('name')).includes(foreign.name))!
      expect(row.findAllComponents(Button)).toHaveLength(0)
      expect(row.findComponent(StatusDot).exists()).toBe(true)
      if (provider === 'forgejo' || provider === 'gitea')
        expect(row.findAllComponents(Icon).map((icon) => icon.props('tooltip'))).toEqual([
          'Edit connection',
          'Connection actions',
        ])
      else {
        expect(row.text()).toMatch(/available in a later version/i)
        expect(row.findAllComponents(Icon).map((icon) => icon.props('tooltip'))).toEqual([
          'Connection actions',
        ])
        expect(read.mock.calls.some(([id]) => id === foreign.keyId)).toBe(false)
      }
      const githubRow = view
        .findAllComponents(Setting)
        .find((row) => String(row.props('name')).includes(github.name))!
      expect(
        githubRow
          .findAllComponents(Icon)
          .some((icon) => icon.props('tooltip') === 'Edit connection')
      ).toBe(true)
      await chooseAction(row, 'Delete')
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
      .findAllComponents(Icon)
      .find((button) => button.props('tooltip') === 'Edit connection')!
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
    await chooseAction(view, 'Delete')
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
