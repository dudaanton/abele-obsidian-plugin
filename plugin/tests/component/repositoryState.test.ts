import { beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceLeaf } from 'obsidian'
import { GithubView } from '@/github/GithubView'
import { githubTabTarget } from '@/repository/state'
import { parseGithubUrl } from '@/github/urls'
import { useVault } from '../helpers/testEnv'
import { InMemoryRepository } from '../helpers/inMemoryRepository'

beforeEach(() => useVault([]))
describe('repository tab state migration', () => {
  it('continues to restore URL-only state and round-trips an explicit source target', async () => {
    const url = 'https://github.com/sample/project/blob/main/app.ts#L3'
    const view = new GithubView(new WorkspaceLeaf())
    await view.setState({ url }, { history: false })
    expect(view.model.target?.kind).toBe('blob')
    expect(view.getState()).toEqual({ url })
    const sourceTarget = githubTabTarget(url, parseGithubUrl(url, ['github.com'])!, '', {
      kind: 'commit',
      commit: 'a'.repeat(40),
    })
    await view.setState({ sourceTarget }, { history: false })
    expect(view.getState()).toEqual({ url, sourceTarget })
  })
  it('preserves a local target without treating the accompanying legacy URL as a GitHub target', async () => {
    const sourceTarget = {
      provider: 'node',
      source: new InMemoryRepository().identity,
      location: { kind: 'file', ref: 'main', path: 'src/app.ts' },
    }
    const view = new GithubView(new WorkspaceLeaf())
    await view.setState(
      { sourceTarget, url: 'https://github.com/private/repo', connectionId: 'private-account' },
      { history: false }
    )
    expect(view.model.target).toBeNull()
    expect(view.model.url).toBe('')
    expect(view.model.connectionId).toBeUndefined()
    expect(view.getState()).toEqual({ url: '', sourceTarget })
    expect(view.getDisplayText()).toBe('Repository')
  })
  it('rejects an invalid explicit local target without falling back to a credential-bearing GitHub view', async () => {
    const sourceTarget = {
      provider: 'node',
      source: new InMemoryRepository().identity,
      location: { kind: 'file', ref: 'main', path: '../outside' },
    }
    const view = new GithubView(new WorkspaceLeaf())
    await view.setState(
      { sourceTarget, url: 'https://github.com/private/repo' },
      { history: false }
    )
    expect(view.model.target).toBeNull()
    expect(view.model.url).toBe('')
    expect(view.model.screen.error).toContain('invalid')
  })
})
