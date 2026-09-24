/**
 * Which tab a GitHub link lands in.
 *
 * A plain click brings forward the tab already showing the item; failing that it points the
 * GitHub tab used last at the link; only with no GitHub tab open does it make a new one. A
 * Mod-click always makes a new one, of the kind `Keymap.isModEvent` names.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkspaceLeaf, type App, type PaneType } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { GITHUB_VIEW_TYPE, noteActiveLeaf, openGithubUrl } from '@/github/GithubService'
import { paneForClick } from '@/github/register'
import { parseGithubUrl, targetKey } from '@/github/urls'
import { useVault } from '../helpers/testEnv'

const PR = 'https://github.com/acme/widgets/pull/42'
const ISSUE = 'https://github.com/acme/widgets/issues/7'
const BLOB = 'https://github.com/acme/widgets/blob/main/src/app.ts#L10-L20'

class Leaf extends WorkspaceLeaf {
  activeTime = 0
  pinned = false
  url = ''

  constructor(url?: string) {
    super()
    if (url) this.show(url)
  }

  private show(url: string) {
    this.url = url
    const target = parseGithubUrl(url, ['github.com'])
    this.view = {
      getViewType: () => GITHUB_VIEW_TYPE,
      targetKey: () => (target ? targetKey(target) : null),
    }
  }

  async setViewState(state: { type: string; state?: unknown }): Promise<void> {
    await super.setViewState(state)
    this.show((state.state as { url: string }).url)
  }
}

function workspace(leaves: Leaf[]) {
  const all: Leaf[] = [...leaves]
  const created: Array<{ pane: unknown; leaf: Leaf }> = []
  const app = {
    workspace: {
      getLeavesOfType: (type: string) =>
        all.filter((l) => (l.view as { getViewType?: () => string })?.getViewType?.() === type),
      getLeaf: vi.fn((pane: unknown) => {
        const leaf = new Leaf()
        created.push({ pane, leaf })
        all.push(leaf)
        return leaf
      }),
      revealLeaf: vi.fn(async () => {}),
    },
  }
  return { app: app as unknown as App, created, reveal: app.workspace.revealLeaf }
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true }
})

describe('a plain click on a GitHub link', () => {
  it('brings forward the tab already showing the item, pointed at the new line', async () => {
    const other = new Leaf(ISSUE)
    other.activeTime = 50
    const same = new Leaf(`${PR}/files`)
    const { app, created, reveal } = workspace([other, same])

    await openGithubUrl(app, `${PR}#issuecomment-9`)

    expect(created).toEqual([])
    expect(same.url).toBe(`${PR}#issuecomment-9`)
    expect(other.url).toBe(ISSUE)
    expect(reveal).toHaveBeenCalledWith(same)
  })

  it('points the GitHub tab used last at a new item, rather than opening another', async () => {
    const older = new Leaf(ISSUE)
    older.activeTime = 10
    const recent = new Leaf(BLOB)
    recent.activeTime = 20
    const { app, created } = workspace([older, recent])

    await openGithubUrl(app, PR)

    expect(created).toEqual([])
    expect(recent.url).toBe(PR)
    expect(older.url).toBe(ISSUE)
  })

  it('follows the tab focus reported, so a split keeps landing in the same pane', async () => {
    const left = new Leaf(ISSUE)
    left.activeTime = 99
    const right = new Leaf(BLOB)
    const { app } = workspace([left, right])
    noteActiveLeaf(right)

    await openGithubUrl(app, PR)

    expect(right.url).toBe(PR)
    expect(left.url).toBe(ISSUE)
  })

  it('leaves a pinned GitHub tab alone', async () => {
    const pinned = new Leaf(ISSUE)
    pinned.pinned = true
    const { app, created } = workspace([pinned])

    await openGithubUrl(app, PR)

    expect(pinned.url).toBe(ISSUE)
    expect(created.map((c) => c.pane)).toEqual(['tab'])
  })

  it('opens a new tab when no GitHub tab is open', async () => {
    const { app, created } = workspace([])

    await openGithubUrl(app, PR)

    expect(created.map((c) => c.pane)).toEqual(['tab'])
    expect(created[0].leaf.url).toBe(PR)
  })

  it('does nothing with a link a tab cannot show', async () => {
    const { app, created } = workspace([])
    expect(await openGithubUrl(app, 'https://github.com/acme/widgets')).toBe(false)
    expect(created).toEqual([])
  })
})

describe('a Mod-click', () => {
  it('opens a new tab even when the item is already open', async () => {
    const same = new Leaf(PR)
    const { app, created } = workspace([same])

    await openGithubUrl(app, `${PR}#issuecomment-9`, 'tab')

    expect(created.map((c) => c.pane)).toEqual(['tab'])
    expect(created[0].leaf.url).toBe(`${PR}#issuecomment-9`)
    expect(same.url).toBe(PR)
  })

  it('opens the split or window Keymap names', async () => {
    for (const pane of ['split', 'window'] as PaneType[]) {
      const { app, created } = workspace([new Leaf(PR)])
      await openGithubUrl(app, ISSUE, pane)
      expect(created.map((c) => c.pane)).toEqual([pane])
    }
  })
})

const click = (mods: Partial<MouseEventInit> = {}) =>
  new MouseEvent('click', { button: 0, ...mods })

describe('what a click asks for', () => {
  it('in reading view and Live Preview: plain reuses, Mod opens anew, Alt goes to the browser', () => {
    expect(paneForClick(click(), false)).toBe(false)
    expect(paneForClick(click({ metaKey: true }), false)).toBe('tab')
    expect(paneForClick(click({ ctrlKey: true }), false)).toBe('tab')
    expect(paneForClick(click({ metaKey: true, altKey: true }), false)).toBe('split')
    expect(paneForClick(click({ metaKey: true, altKey: true, shiftKey: true }), false)).toBe(
      'window'
    )
    expect(paneForClick(click({ altKey: true }), false)).toBeNull()
  })

  it('in source mode: a plain click is the cursor, Mod opens with reuse, Mod+Shift anew', () => {
    expect(paneForClick(click(), true)).toBeNull()
    expect(paneForClick(click({ altKey: true }), true)).toBeNull()
    expect(paneForClick(click({ metaKey: true }), true)).toBe(false)
    expect(paneForClick(click({ metaKey: true, shiftKey: true }), true)).toBe('tab')
    expect(paneForClick(click({ metaKey: true, altKey: true }), true)).toBe('split')
    expect(paneForClick(click({ metaKey: true, altKey: true, shiftKey: true }), true)).toBe(
      'window'
    )
  })
})

describe('a GitHub tab that follows a link', () => {
  it('records where it was, so its back arrow returns there', async () => {
    const { GithubView } = await import('@/github/GithubView')
    const view = new GithubView(new WorkspaceLeaf())
    expect(view.navigation).toBe(true)

    const first = { history: false }
    await view.setState({ url: PR }, first)
    expect(first.history).toBe(false)

    const followed = { history: false }
    await view.setState({ url: ISSUE }, followed)
    expect(followed.history).toBe(true)
  })
})
