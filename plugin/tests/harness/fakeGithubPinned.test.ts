// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeGithub, type FakeGithub } from '../e2e/helpers/githubLive'
import { BASE_SHA, HEAD_SHA } from '../e2e/helpers/fakeGithubRepo'

describe('fake GitHub endpoint trees', () => {
  let gh: FakeGithub
  beforeAll(async () => {
    gh = await startFakeGithub()
  })
  afterAll(() => gh?.stop())
  it('uses different subtree identities when descendant blobs differ and serves lazy subtrees', async () => {
    const read = async (sha: string, recursive = true) =>
      (
        await globalThis.fetch(
          `${gh.origin}/api/v3/repos/acme/widgets/git/trees/${sha}${recursive ? '?recursive=1' : ''}`
        )
      ).json()
    const base = await read(BASE_SHA),
      target = await read(HEAD_SHA)
    const baseSrc = base.tree.find((e: { path: string }) => e.path === 'src')
    const targetSrc = target.tree.find((e: { path: string }) => e.path === 'src')
    expect(baseSrc.sha).not.toBe(targetSrc.sha)
    const subtree = await read(targetSrc.sha, false)
    expect(subtree.tree.map((e: { path: string }) => e.path)).toContain('app.ts')
    expect(subtree.tree.every((e: { path: string }) => !e.path.includes('/'))).toBe(true)
  })
})
