import { describe, expect, it } from 'vitest'
import { BasePins } from '@/github/comparison/pins'
import { deployment } from '@/forge/identity'
import type { RepositorySource } from '@/repository/source'

describe('forge comparison base identity', () => {
  it('retains deployment subpaths, provider and account across a restart', async () => {
    let stored: unknown
    const storage = {
      loadLocalStorage: () => stored,
      saveLocalStorage: (_: string, value: unknown) => {
        stored = value
      },
    }
    const source = (base: string, connection = 'sample') =>
      ({
        identity: {
          provider: 'forgejo',
          deployment: deployment('forgejo', base),
          connection,
          repository: 'sample/project',
        },
        resolve: async () => 'a'.repeat(40),
        assertCurrent() {},
      }) as RepositorySource
    const repo = {
      host: 'forge.example.test',
      origin: 'https://forge.example.test/first',
      owner: 'sample',
      repo: 'project',
    }
    const first = source(repo.origin),
      other = source('https://forge.example.test/second'),
      account = source(repo.origin, 'other')
    const pins = new BasePins(storage)
    pins.save(await pins.resolveSource(first, repo, 'main'))
    const restored = new BasePins(storage)
    expect(restored.get(repo, first.identity)?.baseSha).toBe('a'.repeat(40))
    expect(restored.get(repo, other.identity)).toBeNull()
    expect(restored.get(repo, account.identity)).toBeNull()
    expect(restored.get(repo)).toBeNull()
    restored.unpin(repo, first.identity)
    expect(new BasePins(storage).get(repo, first.identity)).toBeNull()
  })
})
