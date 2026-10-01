// @vitest-environment node
import { request } from 'node:http'
import { expect, it } from 'vitest'
import { startFakeGithub } from '../e2e/helpers/githubLive'

it('drains queued server output and distinguishes profile batches from other GraphQL queries', async () => {
  const gh = await startFakeGithub()
  try {
    const query = (query: string, variables: Record<string, string> = {}) =>
      new Promise<void>((resolve, reject) => {
        const req = request(
          `${gh.origin}/api/graphql`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (response) => {
            response.resume()
            response.on('end', resolve)
            response.on('error', reject)
          }
        )
        req.on('error', reject)
        req.end(JSON.stringify({ query, variables }))
      })
    await query('query { repository { discussionCategories { nodes { name } } } }')
    const before = await gh.drainRequests()
    expect(before.filter((line) => line.startsWith('POST /api/graphql'))).toHaveLength(1)
    expect(before.filter((line) => line.includes('operation=profiles'))).toHaveLength(0)

    await query(
      'query($l0: String!, $l1: String!) { u0: user(login: $l0) { name } u1: user(login: $l1) { name } }',
      { l0: 'alice', l1: 'bob' }
    )
    await query('query { repository { discussionCategories { nodes { name } } } }')
    const after = await gh.drainRequests()
    const profiles = after.filter((line) => line.startsWith('POST /api/graphql operation=profiles'))
    expect(after.filter((line) => line.startsWith('POST /api/graphql'))).toHaveLength(3)
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toContain('logins=alice,bob')
    // A second barrier neither invents a request nor loses one.
    expect(await gh.drainRequests()).toEqual(after)
  } finally {
    gh.stop()
  }
})
