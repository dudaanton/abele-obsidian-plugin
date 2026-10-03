import { describe, expect, it, vi } from 'vitest'
import { GithubUsers } from '@/github/users'
import { deferred } from '../helpers/deferred'

const stored = JSON.stringify({
  version: 1,
  people: { 'github.com\nsample-user': { login: 'sample-user', name: 'Sample', seen: 1 } },
})

describe('GitHub people cache startup', () => {
  it('neither reads nor overwrites the cache when GitHub is never opened', async () => {
    const read = vi.fn(async () => stored)
    const write = vi.fn(async () => {})
    const users = new GithubUsers({ read, write })
    expect(read).not.toHaveBeenCalled()
    await users.save()
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    await users.ready()
    expect(read).toHaveBeenCalledOnce()
    expect(users.size).toBe(1)
  })

  it('waits for a delayed read before writing on unload', async () => {
    const loading = deferred<string | null>()
    const write = vi.fn(async (_text: string) => {})
    const users = new GithubUsers({ read: () => loading.promise, write })
    const ready = users.ready()
    const saving = users.save()
    expect(write).not.toHaveBeenCalled()
    loading.resolve(stored)
    await Promise.all([ready, saving])
    expect(JSON.parse(write.mock.calls[0][0]).people['github.com\nsample-user'].name).toBe('Sample')
  })
})
