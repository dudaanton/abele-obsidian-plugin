import { describe, expect, it, vi } from 'vitest'
import { ConnectionFallback } from '@/github/connectionFallback'
import { ConnectionMemory } from '@/github/connectionRouting'
import { GithubError } from '@/github/client'

const candidates = [
  { id: 'one', reason: 'default' as const },
  { id: 'two', reason: 'alternative' as const },
]

describe('bounded primary-item fallback', () => {
  it('tries the next same-server candidate on an item access denial and reports attempts', async () => {
    const memory = new ConnectionMemory()
    const run = new ConnectionFallback(memory)
    const read = vi.fn(async (id: string) => {
      if (id === 'one') throw new GithubError('not-found', 'Not found', 404)
      return 'visible'
    })
    const result = await run.read({
      candidates,
      repo: 'https://github.com/sample/repo',
      item: 'issue-1',
      generation: (id) => id,
      read,
    })
    expect(result).toMatchObject({
      id: 'two',
      value: 'visible',
      attempts: [{ id: 'one', error: expect.any(String) }],
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(memory.success('https://github.com/sample/repo', (id) => id)).toBe('two')
  })
  it.each(['rate-limit', 'network', 'auth', 'server'] as const)(
    'does not change identity after %s',
    async (kind) => {
      const run = new ConnectionFallback(new ConnectionMemory())
      const read = vi.fn(async () => {
        throw new GithubError(kind as never, 'Stop', 403)
      })
      await expect(
        run.read({ candidates, repo: 'r', item: 'i', generation: (id) => id, read })
      ).rejects.toThrow('Stop')
      expect(read).toHaveBeenCalledOnce()
    }
  )
  it('never overrides explicit selection and retries a refusal after its expiry', async () => {
    let now = 0
    const run = new ConnectionFallback(new ConnectionMemory(() => now))
    const read = vi.fn(async () => {
      throw new GithubError('forbidden', 'Denied', 403)
    })
    const options = { candidates, repo: 'r', item: 'i', generation: (id: string) => id, read }
    await expect(run.read({ ...options, manual: true })).rejects.toThrow('Denied')
    expect(read).toHaveBeenCalledOnce()
    await expect(run.read(options)).rejects.toThrow()
    expect(read).toHaveBeenCalledTimes(2)
    now = 600001
    await expect(run.read(options)).rejects.toThrow()
    expect(read).toHaveBeenCalledTimes(4)
  })
})
