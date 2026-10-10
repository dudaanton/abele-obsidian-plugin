import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Platform } from 'obsidian'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { AbeleConfig, DEFAULT_SETTINGS } from '@/services/AbeleConfig'
import { collectEntries, applyEntries } from '@/transfer/entries'
import { mobileBackground } from '@/ai/mobileBackground'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})
afterEach(() => {
  Platform.isMobile = false
  mobileBackground.destroy()
})

it('shows the two default-off native rows only on mobile', async () => {
  for (const mobile of [false, true]) {
    Platform.isMobile = mobile
    const screen = mount(GeneralSettings, {
      global: { stubs: { Search: true, Dropdown: true, Input: true } },
    })
    const rows = screen
      .findAll('.setting-item')
      .filter((row) => row.text().includes('Keep running in background'))
    expect(rows).toHaveLength(mobile ? 2 : 0)
    for (const row of rows) expect(row.findComponent(Checkbox).props('isEnabled')).toBe(false)
    if (mobile) {
      await rows[0].findComponent(Checkbox).vm.$emit('toggle')
      await rows[1].findComponent(Checkbox).vm.$emit('toggle')
      expect(AbeleConfig.getInstance().ai.backgroundWhileAgents).toBe(true)
      expect(AbeleConfig.getInstance().ai.backgroundAlways).toBe(true)
      const entry = collectEntries({ ...DEFAULT_SETTINGS, ai: AbeleConfig.getInstance().ai }).find(
        (e) => e.section === 'ai-general'
      )!
      const received = applyEntries([entry], {
        ...DEFAULT_SETTINGS,
        ai: { ...DEFAULT_AI_SETTINGS },
      })
      expect(received.ai.backgroundWhileAgents).toBe(true)
      expect(received.ai.backgroundAlways).toBe(true)
    }
    screen.unmount()
  }
})
