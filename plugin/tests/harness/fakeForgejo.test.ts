// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeGithub, type FakeGithub } from '../e2e/helpers/githubLive'
import { OWNER, REPO, PULL, HEAD_SHA, BASE_SHA } from '../e2e/helpers/fakeGithubRepo'

describe.each(['forgejo', 'gitea'] as const)('local %s API personality', (mode) => {
  let server: FakeGithub
  beforeAll(async () => {
    server = await startFakeGithub({ mode })
  })
  afterAll(() => server?.stop())
  it('serves native people, notifications and explicit comment writes', async () => {
    const api = `${server.origin}/forge/api/v1`
    expect((await globalThis.fetch(`${api}/users/sample-user`)).status).toBe(200)
    expect(
      (await globalThis.fetch(`${server.origin}/forge/avatars/sample-user.png?size=64`)).status
    ).toBe(200)
    expect(await (await globalThis.fetch(`${api}/notifications`)).json()).toMatchObject([
      { id: 701, unread: true },
    ])
    const read = await globalThis.fetch(`${api}/notifications/threads/701?to-status=read`, {
      method: 'PATCH',
    })
    expect(read.status).toBe(205)
    expect(
      (
        await globalThis.fetch(`${api}/repos/${OWNER}/${REPO}/issues/7/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: 'Sample native comment' }),
        })
      ).status
    ).toBe(201)
  })
  it('keeps the pinned version and native compare response differences', async () => {
    const api = `${server.origin}/forge/api/v1`
    expect(await (await globalThis.fetch(`${api}/version`)).json()).toEqual({
      version: mode === 'gitea' ? '1.24.0' : '11.0.0',
    })
    const compare = await (
      await globalThis.fetch(`${api}/repos/${OWNER}/${REPO}/compare/${BASE_SHA}...${HEAD_SHA}`)
    ).json()
    expect(Object.hasOwn(compare, 'files')).toBe(mode === 'forgejo')
    expect(compare).toMatchObject({ total_commits: 2 })
  })
  it('serves native commit details, patches, history and immutable blobs', async () => {
    const api = `${server.origin}/forge/api/v1/repos/${OWNER}/${REPO}`
    const commit = await globalThis.fetch(`${api}/git/commits/${HEAD_SHA}`)
    expect(commit.status).toBe(200)
    expect(await commit.json()).toMatchObject({ sha: HEAD_SHA, files: expect.any(Array) })
    expect(await (await globalThis.fetch(`${api}/git/commits/${HEAD_SHA}.diff`)).text()).toContain(
      '@@ '
    )
    const tree = (await (
      await globalThis.fetch(`${api}/git/trees/${BASE_SHA}?recursive=true`)
    ).json()) as { tree: { type: string; sha: string }[] }
    const blob = tree.tree.find((entry) => entry.type === 'blob')!
    expect(await (await globalThis.fetch(`${api}/git/blobs/${blob.sha}`)).json()).toMatchObject({
      encoding: 'base64',
      content: expect.any(String),
    })
    expect(
      await (await globalThis.fetch(`${api}/commits?sha=${HEAD_SHA}&limit=100&page=1`)).json()
    ).toHaveLength(2)
    const archive = await globalThis.fetch(`${api}/archive/${HEAD_SHA}.tar.gz`)
    expect(archive.status).toBe(200)
    expect(new Uint8Array(await archive.arrayBuffer()).slice(0, 2)).toEqual(
      new Uint8Array([31, 139])
    )
  })
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
