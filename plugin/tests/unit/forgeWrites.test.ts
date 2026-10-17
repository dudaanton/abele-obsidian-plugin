import { describe, expect, it, vi } from 'vitest'
import { ForgejoClient } from '@/forge/forgejoClient'
import { deployment } from '@/forge/identity'
import { nativeWrites } from '@/forge/forgejoWrites'
describe('native explicit writes', () => {
  it('allows a new explicit PR after the previously confirmed PR is closed', async () => {
    let posts = 0
    const http = vi.fn(async (r: { method?: string }) => ({
      status: 200,
      headers: {},
      text: '',
      arrayBuffer: new ArrayBuffer(0),
      json: r.method === 'POST' ? { number: ++posts } : { state: 'closed' },
    }))
    const client = new ForgejoClient(
      deployment('forgejo', 'https://closed.example.test'),
      { connectionId: 'closed', generation: 'one', assertCurrent() {} },
      http,
      ''
    )
    const writes = nativeWrites(client, 'sample/project'),
      pull = { title: 'Sample', body: '', head: 'topic', base: 'main', draft: false }
    expect((await writes.create(pull)).number).toBe(1)
    expect((await writes.create(pull)).number).toBe(2)
  })
  it('does not re-post a branch pair after response loss, even if the title changes', async () => {
    const http = vi.fn(async () => {
      throw new Error('Response lost')
    })
    const client = new ForgejoClient(
      deployment('gitea', 'https://lost.example.test'),
      { connectionId: 'lost', generation: 'one', assertCurrent() {} },
      http,
      'sample'
    )
    const writes = nativeWrites(client, 'sample/project'),
      pull = { title: 'First title', body: '', base: 'main', head: 'topic', draft: false }
    await expect(writes.create(pull)).rejects.toThrow(/unknown/i)
    await expect(writes.create({ ...pull, title: 'Another title' })).rejects.toThrow(
      /check the service/i
    )
    const rotated = new ForgejoClient(
      client.deployment,
      { ...client.session, generation: 'two' },
      http,
      'another-sample'
    )
    await expect(nativeWrites(rotated, 'sample/project').create(pull)).rejects.toThrow(
      /check the service/i
    )
    expect(http).toHaveBeenCalledOnce()
  })
  it.each(['forgejo', 'gitea'] as const)(
    'uses supported %s comment, creation and merge payloads only',
    async (kind) => {
      const http = vi.fn(async () => ({
        status: 200,
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
        json: { number: 14, html_url: 'https://git.example.test/sample/project/pulls/14' },
      }))
      const client = new ForgejoClient(
        deployment(kind, 'https://git.example.test'),
        { connectionId: 'writes', generation: kind, assertCurrent() {} },
        http,
        'sample'
      )
      const writes = nativeWrites(client, 'sample/project')
      await expect(
        writes.create({
          title: 'Sample change',
          body: '',
          base: 'main',
          head: 'topic',
          draft: true,
        })
      ).rejects.toThrow(/draft/i)
      await expect(writes.reply(14, 3, 'Reply')).rejects.toThrow(/not available/i)
      expect(http).not.toHaveBeenCalled()
      await writes.comment(14, 'Sample comment')
      await writes.create({
        title: 'Sample change',
        body: '',
        base: 'main',
        head: 'topic',
        draft: false,
      })
      await writes.merge(14, 'a'.repeat(40))
      expect(
        http.mock.calls.map(([r]) => [r.method, new URL(r.url).pathname, JSON.parse(r.body!)])
      ).toEqual([
        ['POST', '/api/v1/repos/sample/project/issues/14/comments', { body: 'Sample comment' }],
        [
          'POST',
          '/api/v1/repos/sample/project/pulls',
          { title: 'Sample change', body: '', base: 'main', head: 'topic' },
        ],
        [
          'POST',
          '/api/v1/repos/sample/project/pulls/14/merge',
          {
            Do: 'merge',
            head_commit_id: 'a'.repeat(40),
            delete_branch_after_merge: false,
            force_merge: false,
            merge_when_checks_succeed: false,
          },
        ],
      ])
    }
  )
})
