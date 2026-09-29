/**
 * Showing a sidebar panel: the panel is opened in the right sidebar when none is open, the
 * reveal is waited for, and a sidebar the reveal left shut — a phone's drawer can stay shut
 * after it — is opened. Only when the reveal is done does the call resolve.
 */
import { describe, it, expect, vi } from 'vitest'
import type { App } from 'obsidian'
import { revealSidebarView } from '@/views/revealSidebarView'

function fakeApp(opts: { revealOpens: boolean; existing?: boolean }) {
  const rightSplit = { collapsed: true, expand: vi.fn(() => (rightSplit.collapsed = false)) }
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
      await new Promise((r) => setTimeout(r, 10))
      order.push('revealed')
      if (opts.revealOpens) rightSplit.collapsed = false
    }),
  }
  return { app: { workspace } as unknown as App, rightSplit, leftSplit, leaf, order, workspace }
}

describe('revealing a sidebar panel', () => {
  it('waits for the reveal before it resolves', async () => {
    const f = fakeApp({ revealOpens: true })
    await revealSidebarView(f.app, 'some-view')
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
})
