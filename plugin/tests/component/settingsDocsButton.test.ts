/**
 * The way from the settings into the documentation: a small link at the top of each settings
 * tab, on every device, that closes the settings and opens the page about that tab. It used to
 * be a full button above the tab strip; Anton asked for it smaller and inside the tab.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Platform } from 'obsidian'
import Settings from '@/components/settings/Settings.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

const opened = vi.hoisted(() => [] as unknown[][])
vi.mock('@/views/UserDocsView', () => ({
  openUserDocs: (...args: unknown[]) => void opened.push(args),
}))

const PAGES = [
  'TasksSettings',
  'LogsSettings',
  'JournalsSettings',
  'AiSettings',
  'FinanceSettings',
  'TimeTrackingSettings',
  'ScriptsSettings',
  'LinksSettings',
  'GithubSettings',
  'ReaderSettings',
  'OtherSettings',
  'TransferSettings',
]
const STUBS = Object.fromEntries(PAGES.map((name) => [name, { template: '<div />' }]))

let closed = 0

beforeEach(() => {
  const app = useVault([]) as unknown as Record<string, unknown>
  closed = 0
  app.setting = { close: () => closed++ }
  opened.length = 0
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

afterEach(() => {
  Platform.isPhone = false
})

const docsButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper
    .findAll('.abele-settings__content .abele-settings__docs .abele-obsidian-icon')
    .find((b) => b.text() === 'Documentation')

describe('the documentation button in the settings', () => {
  it('opens the page about the tab in front, and closes the settings', async () => {
    const wrapper = mount(Settings, { global: { stubs: STUBS } })
    const finance = wrapper.findAll('.abele-tabs__tab').find((t) => t.text() === 'Finance')!
    await finance.trigger('click')

    await docsButton(wrapper)!.trigger('click')

    expect(opened).toEqual([[GlobalStore.getInstance().app, 'finance']])
    expect(closed).toBe(1)
  })

  it('sits inside the tab, not as a full button above the tab strip', () => {
    const wrapper = mount(Settings, { global: { stubs: STUBS } })
    expect(docsButton(wrapper)).toBeDefined()
    expect(wrapper.findAll('button').some((b) => b.text() === 'Documentation')).toBe(false)
  })

  it('on a phone is not on the list of pages, and is on the page once one is open', async () => {
    Platform.isPhone = true
    const wrapper = mount(Settings, { global: { stubs: STUBS } })
    expect(docsButton(wrapper)).toBeUndefined()

    await wrapper.findAll('.abele-tabs__tab')[1].trigger('click')
    expect(docsButton(wrapper)).toBeDefined()
  })
})
