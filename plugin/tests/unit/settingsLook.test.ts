/**
 * What the settings change outside the plugin's own views — classes on `<body>`, the keyboard
 * panel, the first day of the week — is put in force at startup and again whenever the settings
 * are reloaded from disk. A toggle synced from another device otherwise looked ignored here
 * until the next restart.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { applySettingsLook } from '@/helpers/settingsLook'

const diagnostics = vi.hoisted(() => ({ calls: [] as boolean[] }))
vi.mock('@/helpers/keyboardDiagnostics', () => ({
  setKeyboardDiagnostics: (enabled: boolean) => diagnostics.calls.push(enabled),
}))

const look = (over: Partial<Parameters<typeof applySettingsLook>[0]> = {}) => ({
  fullWidthSidebars: false,
  halfWidthSidebarsOnTablet: false,
  keyboardDiagnostics: false,
  weekStartsOnMonday: false,
  ...over,
})

beforeEach(() => {
  document.body.className = ''
  diagnostics.calls.length = 0
})

describe('the settings put in force outside the views', () => {
  it('turns each one on', () => {
    applySettingsLook(
      look({
        fullWidthSidebars: true,
        halfWidthSidebarsOnTablet: true,
        keyboardDiagnostics: true,
        weekStartsOnMonday: true,
      })
    )

    expect(document.body.classList.contains('abele-full-width-sidebars')).toBe(true)
    expect(document.body.classList.contains('abele-half-width-sidebars')).toBe(true)
    expect(diagnostics.calls).toEqual([true])
    expect(dayjs().startOf('week').day()).toBe(1)
    expect(GlobalStore.getInstance().weekStartsOnMonday.value).toBe(true)
  })

  it('turns each one off again, as a reload of settings from another device does', () => {
    applySettingsLook(look({ fullWidthSidebars: true, weekStartsOnMonday: true }))
    applySettingsLook(look())

    expect(document.body.classList.contains('abele-full-width-sidebars')).toBe(false)
    expect(document.body.classList.contains('abele-half-width-sidebars')).toBe(false)
    expect(diagnostics.calls.at(-1)).toBe(false)
    expect(dayjs().startOf('week').day()).toBe(0)
    expect(GlobalStore.getInstance().weekStartsOnMonday.value).toBe(false)
  })
})
