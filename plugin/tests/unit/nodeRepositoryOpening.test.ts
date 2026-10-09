import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { identity, HEAD } from '../helpers/nodeRepositoryFixture'
import { nodeRepositoryLink, parseNodeRepositoryLink } from '@/repository/nodeLinks'
import { openNodeRepositoryTarget } from '@/node/openRepository'
import { GITHUB_VIEW_TYPE } from '@/github/GithubService'
import { linkClickHandler } from '@/github/register'

beforeEach(() => useVault([]))
describe('node repository navigation boundary', () => {
  it('whitelists state and links without transporting endpoints, tokens or grants', () => {
    const link = nodeRepositoryLink({ ...identity, token: 'do-not-export' } as typeof identity, {
      kind: 'file',
      ref: HEAD,
      path: 'src/a space.ts',
      lines: { from: 2, to: 4 },
    })
    const target = parseNodeRepositoryLink(link)!
    expect(target.source).toEqual(identity)
    expect(target.location).toEqual({
      kind: 'file',
      ref: HEAD,
      path: 'src/a space.ts',
      lines: { from: 2, to: 4 },
    })
    expect(link).not.toContain('do-not-export')
    expect(() =>
      nodeRepositoryLink(identity, { kind: 'file', ref: HEAD, path: '.git/config' })
    ).toThrow()
    expect(parseNodeRepositoryLink('https://github.com/sample/project')).toBeNull()
  })
  it('takes a node link from rendered note content independently of the GitHub toggle', () => {
    const app = useVault([])
    const target = parseNodeRepositoryLink(nodeRepositoryLink(identity, { kind: 'home' }))!
    const leaf = { setViewState: vi.fn(), view: { model: { sourceTarget: target } } }
    app.workspace.getLeavesOfType = vi.fn(() => [leaf]) as any
    app.workspace.revealLeaf = vi.fn()
    const root = document.createElement('div')
    root.className = 'markdown-rendered'
    const anchor = document.createElement('a')
    anchor.href = nodeRepositoryLink(identity, { kind: 'home' })
    root.append(anchor)
    root.addEventListener('click', linkClickHandler(app))
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(leaf.setViewState).toHaveBeenCalled()
  })
  it('opens or reuses the same shared tab, never a GitHub tab for a node link', async () => {
    const app = useVault([])
    const target = parseNodeRepositoryLink(
      nodeRepositoryLink(identity, { kind: 'home', ref: 'Working tree' })
    )!
    const setViewState = vi.fn(),
      revealLeaf = vi.fn()
    const leaf = { setViewState, view: { model: { sourceTarget: target } } }
    app.workspace.getLeavesOfType = vi.fn(() => [leaf]) as any
    app.workspace.revealLeaf = revealLeaf
    await openNodeRepositoryTarget(app, target)
    expect(setViewState).toHaveBeenCalledWith({
      type: GITHUB_VIEW_TYPE,
      active: true,
      state: { sourceTarget: target },
    })
    expect(revealLeaf).toHaveBeenCalledWith(leaf)
  })
})
