import { expect, it, vi } from 'vitest'
import { restoreConsentOwner } from '../helpers/restoreConsentOwner'

it('restores the exact original active leaf without closing another retained pane or forcing field focus', () => {
  const original = { id: 'sample-original' },
    other = { id: 'sample-other' },
    leaves = [original, other]
  const ws = {
    activeLeaf: other,
    iterateAllLeaves: (visit: (leaf: { id: string }) => void) => leaves.forEach(visit),
    setActiveLeaf: vi.fn((leaf: { id: string }) => {
      ws.activeLeaf = leaf
    }),
  }
  restoreConsentOwner(ws, original.id)
  expect(ws.activeLeaf).toBe(original)
  expect(ws.setActiveLeaf).toHaveBeenCalledExactlyOnceWith(original, { focus: false })
  expect(leaves).toEqual([original, other])
})
it('refuses to fabricate a replacement owner when the captured leaf is missing', () => {
  const ws = {
    activeLeaf: { id: 'sample-other' },
    iterateAllLeaves: () => {},
    setActiveLeaf: vi.fn(),
  }
  expect(() => restoreConsentOwner(ws, 'sample-missing')).toThrow(/original.*owner/i)
  expect(ws.setActiveLeaf).not.toHaveBeenCalled()
})
it('does not bless or replay an activation that failed to restore the owner', () => {
  const leaf = { id: 'sample-original' },
    ws = {
      activeLeaf: { id: 'sample-other' },
      iterateAllLeaves: (visit: (leaf: { id: string }) => void) => visit(leaf),
      setActiveLeaf: vi.fn(),
    }
  expect(() => restoreConsentOwner(ws, leaf.id)).toThrow(/owner.*not restored/i)
  expect(ws.setActiveLeaf).toHaveBeenCalledOnce()
})
