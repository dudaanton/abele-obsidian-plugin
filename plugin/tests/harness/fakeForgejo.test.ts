// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeGithub, type FakeGithub } from '../e2e/helpers/githubLive'
import { OWNER, REPO, PULL } from '../e2e/helpers/fakeGithubRepo'

describe('local Forgejo API personality', () => {
  let server: FakeGithub
  beforeAll(async () => {
    server = await startFakeGithub({ mode: 'forgejo' })
  })
  afterAll(() => server?.stop())
  it('uses native paths, metadata, credentials, pagination and raw diffs', async () => {
    const api = `${server.origin}/forge/api/v1`
    const user = await globalThis.fetch(`${api}/user`, {
      headers: { Authorization: 'token invented-connection-two' },
    })
    expect(await user.json()).toMatchObject({ login: 'sample-account-two' })
    const repo = await globalThis.fetch(`${api}/repos/${OWNER}/${REPO}`)
    expect(await repo.json()).toMatchObject({ stars_count: 1234, empty: false })
    const privateRepo = await globalThis.fetch(`${api}/repos/${OWNER}/private-widgets`)
    expect(privateRepo.status).toBe(404)
    const files = await globalThis.fetch(
      `${api}/repos/${OWNER}/${REPO}/pulls/${PULL}/files?limit=1&page=2`
    )
    const list = (await files.json()) as unknown[]
    expect(list).toHaveLength(1)
    expect(list[0]).not.toHaveProperty('patch')
    const diff = await globalThis.fetch(`${api}/repos/${OWNER}/${REPO}/pulls/${PULL}.diff`)
    expect(await diff.text()).toContain('@@ ')
    expect((await globalThis.fetch(`${server.origin}/api/v3/user`)).status).toBe(404)
  })
})
