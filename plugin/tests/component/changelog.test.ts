import { mount } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'
import { expect, it, vi } from 'vitest'
import type { App, Plugin, WorkspaceLeaf, ViewStateResult } from 'obsidian'
import { registerChangelog, CHANGELOG_VERSION_KEY, showOffer } from '@/changelog/register'
import { ChangelogView, openChangelog } from '@/changelog/ChangelogView'
import * as changelogViews from '@/changelog/ChangelogView'
import OtherSettings from '@/components/settings/OtherSettings.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'
import Changelog from '@/components/changelog/Changelog.vue'
import type { Release, Range } from '@/changelog/model'

// Keep the real view adapter available; only Obsidian's Notice host is replaced.
const notices = vi.hoisted(
  () => [] as { messageEl: HTMLElement; hide: ReturnType<typeof vi.fn>; duration: number }[]
)
vi.mock('obsidian', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    Notice: class {
      messageEl = document.createElement('div')
      hide = vi.fn(() => this.messageEl.remove())
      constructor(
        text: string,
        public duration: number
      ) {
        this.messageEl.textContent = text
        document.body.append(this.messageEl)
        notices.push(this)
      }
    },
  }
})

it('pages every version newest first, filters before paging, escapes text and resets paging and scroll', async () => {
  const releases: Release[] = Array.from({ length: 23 }, (_, n) => ({
    version: `1.${23 - n}.0`,
    date: '2025-01-01',
    features:
      n === 0 ? ['<img src=x onerror=alert(1)> https://example.invalid'] : [`Sample item ${n}`],
    fixes: [],
    improvements: [],
  }))
  const model = reactive<{ range: Range | null }>({ range: null })
  const wrapper = mount(Changelog, { props: { releases, model } })
  expect(wrapper.findAll('article')).toHaveLength(10)
  expect(wrapper.find('article').text()).toContain('1.23.0')
  expect(wrapper.find('article').text()).toContain('2025-01-01')
  expect(wrapper.find('article').text()).toContain('New features')
  expect(wrapper.find('img, a, iframe, script').exists()).toBe(false)
  await wrapper.find('button').trigger('click')
  expect(wrapper.findAll('article')).toHaveLength(20)
  await wrapper.find('button').trigger('click')
  expect(wrapper.findAll('article')).toHaveLength(23)
  expect(wrapper.findAll('article').at(-1)?.text()).toContain('1.1.0')
  const scroller = wrapper.find('.abele-changelog__scroll').element as HTMLElement
  scroller.scrollTop = 200
  model.range = { from: '1.20.0', to: '1.23.0' }
  await nextTick()
  await nextTick()
  expect(scroller.scrollTop).toBe(0)
  expect(wrapper.findAll('article')).toHaveLength(3)
  expect(wrapper.text()).toContain("What's new since 1.20.0 through 1.23.0")
  expect(wrapper.find('h1').element.textContent).toBe("What's new since 1.20.0 through 1.23.0")
  await wrapper.find('button').trigger('click')
  expect(wrapper.findAll('article')).toHaveLength(10)
  wrapper.unmount()
})

it('pages a full catalog through its oldest version after resetting a range', async () => {
  // Catalog provenance is checked separately in integration/changelogCatalog.test.ts.
  // Exercise many pages here without regenerating Git history for a DOM paging guarantee.
  const releases: Release[] = [
    ...Array.from({ length: 153 }, (_, n) => `1.${153 - n}.0`),
    '0.0.1',
  ].map((version) => ({ version, date: '2025-01-01', features: [], fixes: [], improvements: [] }))
  const model = reactive<{ range: Range | null }>({
    range: { from: '1.56.0', to: '1.58.0' },
  })
  const wrapper = mount(Changelog, { props: { releases, model } })
  const headings = () => wrapper.findAll('article h2').map((heading) => heading.text())
  try {
    expect(headings()).toEqual(['1.58.0', '1.57.0'])
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('h1').text()).toBe('All versions')
    for (let count = 10; count < releases.length; count += 10) {
      expect(headings()).toEqual(releases.slice(0, count).map((release) => release.version))
      const older = wrapper
        .findAll('button')
        .find((button) => button.text() === 'Show older versions')!
      expect(older).toBeDefined()
      await older.trigger('click')
    }
    expect(headings()).toEqual(releases.map((release) => release.version))
    expect(headings().at(-1)).toBe('0.0.1')
    expect(
      wrapper.findAll('button').some((button) => button.text() === 'Show older versions')
    ).toBe(false)
  } finally {
    wrapper.unmount()
  }
})

it('honestly displays maintenance-only, empty ranges and recovered dates', () => {
  const releases: Release[] = [
    {
      version: '1.0.0',
      date: '2025-01-01',
      dateSource: 'history',
      features: [],
      fixes: [],
      improvements: [],
    },
  ]
  const wrapper = mount(Changelog, { props: { releases, model: { range: null } } })
  expect(wrapper.text()).toContain('No user-facing changes recorded')
  expect(wrapper.text()).toContain('Recovered version history')
  wrapper.unmount()
  const empty = mount(Changelog, {
    props: { releases, model: { range: { from: '2.0.0', to: '3.0.0' } } },
  })
  expect(empty.text()).toContain('No versions in this range')
  empty.unmount()
})

it('registers outside AI gating, stores only locally, defers the captured range and cleans up on unload', async () => {
  let ready = () => {},
    stop = () => {}
  let value: unknown = { schema: 1, lastRunVersion: '1.0.0' }
  const leaf = { setViewState: vi.fn(async () => {}), view: {} }
  const app = {
    loadLocalStorage: vi.fn(() => value),
    saveLocalStorage: vi.fn((_key: string, next: unknown) => {
      value = next
    }),
    workspace: {
      onLayoutReady: (callback: () => void) => {
        ready = callback
      },
      getLeavesOfType: () => [leaf],
      revealLeaf: vi.fn(async () => {}),
    },
  }
  const plugin = {
    app,
    registerView: vi.fn(),
    addCommand: vi.fn(),
    register: (callback: () => void) => {
      stop = callback
    },
    saveData: vi.fn(),
  }
  registerChangelog(plugin as unknown as Plugin)
  expect(plugin.registerView).toHaveBeenCalledWith('abele-changelog', expect.any(Function))
  expect(plugin.addCommand.mock.calls[0][0].id).toBe('open-changelog')
  expect(app.saveLocalStorage).toHaveBeenCalledWith(CHANGELOG_VERSION_KEY, {
    schema: 1,
    lastRunVersion: '1.2.0',
  })
  expect(plugin.saveData).not.toHaveBeenCalled()
  expect(notices).toHaveLength(0)
  ready()
  ready()
  expect(notices).toHaveLength(1)
  expect(notices[0].duration).toBe(12_000)
  expect(notices[0].messageEl.textContent).toContain('since 1.0.0')
  const buttons = notices[0].messageEl.querySelectorAll('button')
  expect([...buttons].map((b) => b.textContent)).toEqual(["What's new", 'Dismiss'])
  buttons[0].click()
  await nextTick()
  expect(leaf.setViewState).toHaveBeenCalledWith({
    type: 'abele-changelog',
    active: true,
    state: { range: { from: '1.0.0', to: '1.2.0' } },
  })
  expect(notices[0].hide).toHaveBeenCalled()
  stop()
  expect(notices[0].hide).toHaveBeenCalledTimes(2)
  notices.length = 0
})

it('manual entry reuses a leaf, resets all versions and does not touch storage', async () => {
  const leaf = { setViewState: vi.fn(async () => {}) }
  const app = {
    workspace: {
      getLeavesOfType: () => [leaf],
      getLeaf: vi.fn(),
      revealLeaf: vi.fn(async () => {}),
    },
    saveLocalStorage: vi.fn(),
  }
  await openChangelog(app as unknown as App)
  expect(leaf.setViewState).toHaveBeenCalledWith({
    type: 'abele-changelog',
    active: true,
    state: { range: null },
  })
  expect(app.workspace.getLeaf).not.toHaveBeenCalled()
  expect(app.saveLocalStorage).not.toHaveBeenCalled()
  expect(notices).toHaveLength(0)
})

it('validates and clamps restored ranges, mounts and unmounts its own component', async () => {
  const view = new ChangelogView({} as WorkspaceLeaf)
  const content = document.createElement('div')
  Object.defineProperty(view, 'contentEl', { value: content })
  await view.onOpen()
  expect(content.querySelector('article')).not.toBeNull()
  await view.setState({ range: { from: '1.0.0', to: '9.0.0' } }, {} as ViewStateResult)
  expect(view.getState()).toEqual({ range: { from: '1.0.0', to: '1.2.0' } })
  await nextTick()
  expect(content.querySelectorAll('article')).toHaveLength(2)
  await view.setState({ range: { from: '2.0.0', to: '1.0.0' } }, {} as ViewStateResult)
  expect(view.getState()).toEqual({ range: null })
  await view.onClose()
  expect(content.querySelector('.abele-changelog')).toBeNull()
})

it('dismissal hides the finite notice without opening a tab', () => {
  const app = { workspace: { getLeavesOfType: vi.fn() } }
  const hide = showOffer(app as unknown as App, { from: '1.0.0', to: '1.2.0' })
  const notice = notices.at(-1)!
  notice.messageEl.querySelectorAll('button')[1].click()
  expect(notice.hide).toHaveBeenCalledOnce()
  expect(app.workspace.getLeavesOfType).not.toHaveBeenCalled()
  hide()
  notices.length = 0
})

it('closes settings before opening all versions without changing settings', async () => {
  const app = useVault([]) as unknown as { setting: { close: ReturnType<typeof vi.fn> } }
  app.setting = { close: vi.fn() }
  const save = vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  // A per-case spy avoids hiding the real ChangelogView from the adapter cases above.
  const opened = vi.spyOn(changelogViews, 'openChangelog').mockResolvedValue(undefined)
  const wrapper = mount(OtherSettings)
  try {
    const button = wrapper.findAll('button').find((b) => b.text() === 'Open changelog')!
    expect(button).toBeDefined()
    await button.trigger('click')
    expect(app.setting.close).toHaveBeenCalledOnce()
    expect(opened).toHaveBeenCalledExactlyOnceWith(app)
    expect(app.setting.close.mock.invocationCallOrder[0]).toBeLessThan(
      opened.mock.invocationCallOrder[0]
    )
    expect(save).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
    opened.mockRestore()
    save.mockRestore()
  }
})
