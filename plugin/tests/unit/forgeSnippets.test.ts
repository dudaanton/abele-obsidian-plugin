import { describe, expect, it } from 'vitest'
import { formatSnippet, parseSnippet } from '@/github/snippetBlock'
import { deployment } from '@/forge/identity'
import { diffLink } from '@/github/permalinks'
describe('neutral retained snippets and links', () => {
  it('round-trips a versioned native snippet without a connection or credential reference', () => {
    const source = {
      version: 1 as const,
      deployment: deployment('gitea', 'https://git.example.test/team'),
      repository: 'sample/project',
    }
    const snippet = {
      source,
      kind: 'code' as const,
      url: `${source.deployment.webBase}/sample/project/src/commit/${'a'.repeat(40)}/sample.ts#L1`,
      label: 'Sample code',
      text: 'sample',
      start: 1,
    }
    const block = formatSnippet(snippet)
    expect(block).toMatch(/^```abele-forge\n/)
    expect(parseSnippet(block.split('\n').slice(1, -1).join('\n'))).toEqual(snippet)
    expect(
      parseSnippet(block.split('\n').slice(1, -1).join('\n').replace('version: 1', 'version: 99'))
    ).toBeNull()
  })
  it('uses immutable native file links when proven, and a broad change link otherwise', () => {
    const item = {
      provider: 'forgejo' as const,
      kind: 'pull' as const,
      host: 'git.example.test',
      origin: 'https://git.example.test/team',
      owner: 'sample',
      repo: 'project',
      number: 12,
      headSha: 'a'.repeat(40),
    }
    expect(
      diffLink(item, { path: 'sample.ts', hash: '' }, { side: 'R', start: 2, end: 3 }).url
    ).toBe(`${item.origin}/sample/project/src/commit/${item.headSha}/sample.ts#L2-L3`)
    expect(
      diffLink(item, { path: 'sample.ts', hash: '' }, { side: 'L', start: 2, end: 3 }).url
    ).toBe(`${item.origin}/sample/project/pulls/12/files`)
  })
})
