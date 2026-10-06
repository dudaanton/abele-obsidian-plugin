import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../e2e/helpers/obsidianCli', () => ({
  evalJsonIdempotent: (code: string) => new Function(`return ${code}`)(),
  evalRawIdempotent: vi.fn(),
}))
import { assertNoLeakedRootViews, snapshotRootViews } from '../e2e/helpers/rootViews'

function leaf(id: string, type: string) {
  return { id, view: { getViewType: () => type }, detach: vi.fn() }
}

afterEach(() => vi.unstubAllGlobals())

describe('per-file root view ownership', () => {
  it('names a leaked plugin view and closes only the newly added leaf', () => {
    const existing = leaf('old-panel', 'abele-ai-sidebar-view')
    const note = leaf('old-note', 'markdown')
    const leaves = [existing, note]
    vi.stubGlobal('app', {
      workspace: { iterateRootLeaves: (visit: (l: unknown) => void) => leaves.forEach(visit) },
    })
    const before = snapshotRootViews()
    const added = leaf('new-panel', 'abele-script-runs-view')
    const second = leaf('second-panel', 'abele-ai-sidebar-view')
    // Detaching mutates the workspace's live sibling array.
    added.detach.mockImplementation(() => {
      leaves.splice(leaves.indexOf(added), 1)
    })
    leaves.push(added, second)
    expect(() => assertNoLeakedRootViews(before)).toThrow('abele-script-runs-view')
    expect(added.detach).toHaveBeenCalledOnce()
    expect(second.detach).toHaveBeenCalledOnce()
    expect(existing.detach).not.toHaveBeenCalled()
    expect(note.detach).not.toHaveBeenCalled()
  })

  it('fails on an old tab converted to a plugin view without detaching that tab', () => {
    const tab = leaf('old-tab', 'markdown')
    vi.stubGlobal('app', {
      workspace: { iterateRootLeaves: (visit: (l: unknown) => void) => visit(tab) },
    })
    const before = snapshotRootViews()
    tab.view.getViewType = () => 'abele-ai-sidebar-view'
    expect(() => assertNoLeakedRootViews(before)).toThrow('abele-ai-sidebar-view')
    expect(tab.detach).not.toHaveBeenCalled()
  })

  it('allows the same pre-existing plugin view and new ordinary note tabs', () => {
    const leaves = [leaf('old-panel', 'abele-ai-sidebar-view')]
    vi.stubGlobal('app', {
      workspace: { iterateRootLeaves: (visit: (l: unknown) => void) => leaves.forEach(visit) },
    })
    const before = snapshotRootViews()
    leaves.push(leaf('new-note', 'markdown'))
    expect(() => assertNoLeakedRootViews(before)).not.toThrow()
  })
})
