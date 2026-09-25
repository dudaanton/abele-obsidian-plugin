/**
 * How wide a GitHub tab lets its text run: the notes' line width, pixels, or the whole pane —
 * followed at once when the setting changes, without reopening the tab. Diffs and code are not
 * held to it; that is CSS (`:has(.abele-github-files, .abele-github-blob)`), which happy-dom
 * does not lay out, so it is checked in the app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ISSUE, openTab } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS, type GithubSettings } from '@/github/settings'
import { pageWidthCss } from '@/github/pageWidth'
import GithubSettingsView from '@/components/settings/GithubSettings.vue'

const configure = (patch: Partial<GithubSettings>) => {
  const config = AbeleConfig.getInstance()
  config.github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true, ...patch }
  config.version.value++
}

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
  configure({})
})

describe('the width a tab’s text runs to', () => {
  it('is the notes’ line width, a width in pixels, or the whole pane', () => {
    expect(pageWidthCss({ pageWidth: 'readable', pageWidthPx: 1000 })).toBe(
      'var(--file-line-width)'
    )
    expect(pageWidthCss({ pageWidth: 'custom', pageWidthPx: 1200 })).toBe('1200px')
    expect(pageWidthCss({ pageWidth: 'full', pageWidthPx: 1200 })).toBe('100%')
  })

  it('keeps a width in pixels within reason, and falls back to the notes’ without one', () => {
    expect(pageWidthCss({ pageWidth: 'custom', pageWidthPx: 50 })).toBe('400px')
    expect(pageWidthCss({ pageWidth: 'custom', pageWidthPx: 99999 })).toBe('4000px')
    expect(pageWidthCss({ pageWidth: 'custom', pageWidthPx: Number.NaN })).toBe(
      'var(--file-line-width)'
    )
  })

  it('is 1000 pixels unless changed', () => {
    expect(pageWidthCss(DEFAULT_GITHUB_SETTINGS)).toBe('1000px')
  })

  it('is put on the tab, and follows the setting without reopening it', async () => {
    const { wrapper } = openTab('https://github.com/o/r/issues/5', {
      '/repos/o/r/issues/5': { json: ISSUE },
      '/repos/o/r/issues/5/comments': { json: [] },
    })
    await flushPromises()
    const root = wrapper.find('.abele-github').element as HTMLElement
    expect(root.style.getPropertyValue('--abele-github-width')).toBe('1000px')

    configure({ pageWidth: 'full' })
    await flushPromises()
    expect(root.style.getPropertyValue('--abele-github-width')).toBe('100%')

    configure({ pageWidth: 'readable' })
    await flushPromises()
    expect(root.style.getPropertyValue('--abele-github-width')).toBe('var(--file-line-width)')
  })
})

describe('the setting', () => {
  beforeEach(() => {
    vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  })

  it('offers the three widths, and the pixels only for a width in pixels', async () => {
    const wrapper = mount(GithubSettingsView, { attachTo: document.body })
    const select = wrapper
      .findAll('.abele-settings__github select')
      .find((s) => s.findAll('option').some((o) => o.element.value === 'full'))!
    expect(select.findAll('option').map((o) => o.element.value)).toEqual([
      'readable',
      'custom',
      'full',
    ])
    expect(wrapper.text()).toContain('Width in pixels')

    await select.setValue('full')
    expect(AbeleConfig.getInstance().github.pageWidth).toBe('full')
    await flushPromises()
    expect(wrapper.findAll('.setting-item-name').map((n) => n.text())).not.toContain(
      'Width in pixels'
    )
  })
})
