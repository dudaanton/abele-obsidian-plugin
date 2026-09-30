/**
 * Showing a sidebar panel: the panel is opened in the right sidebar when none is open, the
 * reveal is waited for, and a sidebar the reveal left shut — a phone's drawer can stay shut
 * after it — is opened. Only when the reveal is done does the call resolve.
 */
import { describe, it, expect, vi } from 'vitest'
import { Platform, type App } from 'obsidian'
import { revealSidebarView } from '@/views/revealSidebarView'
import { deferred } from '../helpers/deferred'
import { flushPromises } from '@vue/test-utils'

function fakeApp(opts: { revealOpens: boolean; existing?: boolean; reveal?: Promise<void> }) {
  const rightSplit = {
    collapsed: true,
    containerEl: { offsetWidth: 330 },
    expand: vi.fn(() => {
      rightSplit.collapsed = false
      rightSplit.containerEl.offsetWidth = 330
    }),
    collapse: vi.fn(() => (rightSplit.collapsed = true)),
  }
  const leftSplit = { collapsed: true, expand: vi.fn(() => (leftSplit.collapsed = false)) }
  const order: string[] = []
  const leaf = {
    getRoot: () => rightSplit,
    setViewState: vi.fn(async () => void order.push('setViewState')),
  }
  const workspace = {
    rightSplit,
    leftSplit,
    getLeavesOfType: () => (opts.existing ? [leaf] : []),
    getRightLeaf: () => leaf,
    revealLeaf: vi.fn(async () => {
      await (opts.reveal ?? Promise.resolve())
      order.push('revealed')
      if (opts.revealOpens) rightSplit.collapsed = false
    }),
  }
  return { app: { workspace } as unknown as App, rightSplit, leftSplit, leaf, order, workspace }
}

describe('revealing a sidebar panel', () => {
  it('waits for the reveal before it resolves', async () => {
    const reveal = deferred()
    const f = fakeApp({ revealOpens: true, reveal: reveal.promise })
    let settled = false
    const opening = revealSidebarView(f.app, 'some-view').then(() => {
      settled = true
    })
    await flushPromises()
    expect(settled).toBe(false)
    expect(f.order).toEqual(['setViewState'])
    reveal.resolve()
    await opening
    expect(f.order).toEqual(['setViewState', 'revealed'])
    expect(f.rightSplit.collapsed).toBe(false)
    expect(f.rightSplit.expand).not.toHaveBeenCalled()
  })

  it('opens the sidebar the reveal left shut', async () => {
    const f = fakeApp({ revealOpens: false, existing: true })
    await revealSidebarView(f.app, 'some-view')
    expect(f.workspace.revealLeaf).toHaveBeenCalled()
    expect(f.rightSplit.expand).toHaveBeenCalled()
    expect(f.rightSplit.collapsed).toBe(false)
    expect(f.leftSplit.expand).not.toHaveBeenCalled()
  })

  it('on a phone, opens again a drawer that hid itself while counting as open', async () => {
    const f = fakeApp({ revealOpens: true, existing: true })
    // A drawer that was closing when the reveal came: open by its flag, hidden on screen.
    f.workspace.revealLeaf.mockImplementation(async () => {
      f.rightSplit.collapsed = false
      f.rightSplit.containerEl.offsetWidth = 0
    })
    Platform.isMobile = true
    try {
      await revealSidebarView(f.app, 'some-view')
    } finally {
      Platform.isMobile = false
    }
    expect(f.rightSplit.collapse).toHaveBeenCalled()
    expect(f.rightSplit.expand).toHaveBeenCalled()
    expect(f.rightSplit.containerEl.offsetWidth).toBe(330)
    expect(f.rightSplit.collapsed).toBe(false)
  })

  it('on a phone, leaves a drawer that opened alone', async () => {
    const f = fakeApp({ revealOpens: true, existing: true })
    Platform.isMobile = true
    try {
      await revealSidebarView(f.app, 'some-view')
    } finally {
      Platform.isMobile = false
    }
    expect(f.rightSplit.collapse).not.toHaveBeenCalled()
  })
})
