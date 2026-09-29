import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { App, Plugin, WorkspaceLeaf, ViewStateResult } from 'obsidian'
import { registerChangelog, CHANGELOG_VERSION_KEY, showOffer } from '@/changelog/register'
import { ChangelogView, openChangelog } from '@/changelog/ChangelogView'

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
