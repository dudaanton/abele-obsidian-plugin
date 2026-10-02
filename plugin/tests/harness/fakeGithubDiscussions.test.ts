// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeGithub, type FakeGithub } from '../e2e/helpers/githubLive'

describe('fake GitHub discussion access probe', () => {
  let gh: FakeGithub
  beforeAll(async () => {
    gh = await startFakeGithub()
  })
  afterAll(() => gh?.stop())

  it('answers the repository discussion count before list searches are admitted', async () => {
    // The primary-access query is distinct from both search(type:DISCUSSION) and categories.
    const query =
      'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){discussions(first:1){totalCount}}}'
    const response = await fetch(`${gh.origin}/api/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { owner: 'acme', name: 'widgets' } }),
    })
    expect(await response.json()).toEqual({
      data: { repository: { discussions: { totalCount: 1 } } },
    })
    expect((await gh.drainRequests()).some((line) => line.includes(query))).toBe(true)
  })
})
