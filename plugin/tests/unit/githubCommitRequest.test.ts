import { describe, expect, it } from 'vitest'
import { commitRequest } from '@/github/commitRequest'
import { primaryAccessKey } from '@/github/primaryAccess'
import type { GithubTarget } from '@/github/urls'

const repo = { host: 'github.com', owner: 'sample', repo: 'project' }
const pull: GithubTarget = { ...repo, kind: 'pull', number: 42, tab: 'conversation' }

describe('shared commit resource selection', () => {
  it('uses the same SHA-over-comparison-over-pull precedence as execution', () => {
    expect(
      commitRequest({ target: pull }, { sha: 'sample-sha', base: 'main', head: 'feature', pull: 7 })
    ).toEqual({ kind: 'commit', sha: 'sample-sha' })
    expect(commitRequest({ target: pull }, { base: 'main', head: 'feature', pull: 7 })).toEqual({
      kind: 'compare',
      base: 'main',
      head: 'feature',
    })
    expect(commitRequest({ target: pull }, { pull: 7 })).toEqual({
      kind: 'pull-commits',
      number: 7,
    })
    expect(commitRequest({ number: 42 }, {})).toEqual({ kind: 'pull-commits', number: 42 })
  })
  it('keeps a lone-ref comparison and explicit overrides coherent', () => {
    const target: GithubTarget = { ...repo, kind: 'compare', head: 'feature', direct: false }
    expect(commitRequest({ target }, {})).toEqual({
      kind: 'compare',
      head: 'feature',
      base: undefined,
    })
    expect(commitRequest({ target }, { base: 'release', head: 'new-head' })).toEqual({
      kind: 'compare',
      base: 'release',
      head: 'new-head',
    })
    expect(() => commitRequest({}, { head: 'feature' })).toThrow('both base and head')
  })
  it('includes history filters and separates their refusal memory from repository and PR metadata', () => {
    const request = commitRequest({}, { ref: 'feature/topic', path: 'src/sample.ts', page: 2 })
    expect(request).toEqual({
      kind: 'commit-history',
      ref: 'feature/topic',
      path: 'src/sample.ts',
      page: 2,
    })
    const history = {
      ...repo,
      kind: 'commit-history' as const,
      ref: 'feature/topic',
      path: 'src/sample.ts',
      page: 2,
    }
    expect(primaryAccessKey(history)).not.toBe(primaryAccessKey({ ...repo, kind: 'repo' }))
    expect(primaryAccessKey(history)).not.toBe(primaryAccessKey({ ...history, path: 'other.ts' }))
    expect(primaryAccessKey({ ...repo, kind: 'pull-commits', number: 42 })).not.toBe(
      primaryAccessKey(pull)
    )
  })
})
