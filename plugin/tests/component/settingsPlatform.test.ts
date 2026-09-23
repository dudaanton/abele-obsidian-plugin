/**
 * How the settings screen and the sidebar settings adapt to the device they are on.
 *
 * Obsidian has three shapes, not two: a desktop, a phone, and a tablet — which is mobile but
 * not a phone. Its own settings dialog on a tablet is laid out like the desktop one, a list of
 * pages on the left and the page on the right, with no back button. A screen that treats
 * every mobile device as a phone shows a tablet a list it can never return to.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Platform } from 'obsidian'
import Settings from '@/components/settings/Settings.vue'
import OtherSettings from '@/components/settings/OtherSettings.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

type Device = 'desktop' | 'phone' | 'tablet'

const platform = Platform as unknown as Record<string, boolean>

const pretendToBe = (device: Device) => {
  platform.isDesktop = device === 'desktop'
  platform.isMobile = device !== 'desktop'
  platform.isPhone = device === 'phone'
  platform.isTablet = device === 'tablet'
}

/** Each page is its own screen with its own tests; here only the frame around them matters. */
const PAGES = [
  'TasksSettings',
  'LogsSettings',
  'JournalsSettings',
  'AiSettings',
  'FinanceSettings',
  'TimeTrackingSettings',
  'ScriptsSettings',
  'LinksSettings',
  'OtherSettings',
  'TransferSettings',
]
const STUBS = Object.fromEntries(
  PAGES.map((name) => [name, { template: `<div class="page-stub" />` }])
)

const openSettings = () => mount(Settings, { global: { stubs: STUBS } })

beforeEach(() => {
  useVault([])
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

afterEach(() => {
  pretendToBe('desktop')
  document.body.className = ''
})

describe('the settings screen', () => {
  it('on a desktop shows the tab strip and the page together', () => {
    pretendToBe('desktop')
    const wrapper = openSettings()

    expect(wrapper.find('.abele-settings__nav').exists()).toBe(true)
    expect(wrapper.find('.abele-tabs_vertical').exists()).toBe(false)
    expect(wrapper.find('.page-stub').exists()).toBe(true)
  })

  it('on a phone starts from a list of pages to descend into', () => {
    pretendToBe('phone')
    const wrapper = openSettings()

    expect(wrapper.find('.abele-tabs_vertical').exists()).toBe(true)
    expect(wrapper.find('.page-stub').exists()).toBe(false)
  })

  it('on a tablet shows the tab strip and the page together, as the desktop does', async () => {
    pretendToBe('tablet')
    const wrapper = openSettings()

    expect(wrapper.find('.abele-tabs_vertical').exists()).toBe(false)
    expect(wrapper.find('.page-stub').exists()).toBe(true)

    // Picking a page must not take the strip away: a tablet has no back button to bring it back.
    await wrapper.findAll('.abele-tabs__tab')[2].trigger('click')
    expect(wrapper.find('.abele-settings__nav').exists()).toBe(true)
    expect(wrapper.find('.page-stub').exists()).toBe(true)
  })
})

describe('the sidebar width settings', () => {
  const rowFor = (wrapper: ReturnType<typeof mount>, name: string) => {
    const row = wrapper.findAllComponents(Setting).find((s) => s.props('name') === name)
    if (!row) throw new Error(`No settings row named "${name}"`)
    return row
  }

  it('offers half-width sidebars for a tablet, and remembers the choice', async () => {
    const config = AbeleConfig.getInstance()
    config.halfWidthSidebarsOnTablet = false
    const wrapper = mount(OtherSettings, { global: { stubs: { Input: true } } })

    await rowFor(wrapper, 'Half-width sidebars on tablet').findComponent(Checkbox).trigger('click')

    expect(config.halfWidthSidebarsOnTablet).toBe(true)
    expect(config.saveSettings).toHaveBeenCalled()
    expect(document.body.classList.contains('abele-half-width-sidebars')).toBe(true)
  })

  it('puts the class on the body when the setting was already on', () => {
    AbeleConfig.getInstance().halfWidthSidebarsOnTablet = true
    mount(OtherSettings, { global: { stubs: { Input: true } } })

    expect(document.body.classList.contains('abele-half-width-sidebars')).toBe(true)
  })
})
