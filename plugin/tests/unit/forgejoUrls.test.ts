import { describe, expect, it } from 'vitest'
import { forgejoUrls } from '@/forge/forgejoUrls'
import { deployment } from '@/forge/identity'
import { hrefAction, rawUrl } from '@/github/markdownLinks'
import { blobLink, fileUrl, itemUrl } from '@/github/permalinks'

const urls = forgejoUrls(deployment('forgejo', 'https://forge.example.test/team'))
describe('Forgejo links', () => {
  it('opens Markdown line citations as source while retaining the immutable revision', () => {
    const sha = 'a'.repeat(40)
    const url = urls.file('sample/project', sha, 'docs/sample.md', { from: 2, to: 3 })
    expect(url).toBe(
      `https://forge.example.test/team/sample/project/src/commit/${sha}/docs/sample.md?display=source#L2-L3`
    )
    expect(urls.parse(url)).toMatchObject({ plain: true, lines: { start: 2, end: 3 } })
  })
  it('uses native routes for prose, images, items and immutable citations', () => {
    const repo = {
      provider: 'forgejo' as const,
      origin: 'https://forge.example.test/team',
      host: 'forge.example.test',
      owner: 'sample',
      repo: 'project',
      ref: 'a'.repeat(40),
      path: 'docs/README.md',
    }
    expect(hrefAction('../src/sample.ts', repo)).toEqual({
      kind: 'repo',
      url: `${repo.origin}/sample/project/src/commit/${repo.ref}/src/sample.ts`,
    })
    expect(rawUrl(repo, ['sample.png'])).toBe(
      `${repo.origin}/sample/project/raw/commit/${repo.ref}/sample.png`
    )
    expect(itemUrl({ ...repo, kind: 'pull', number: 12 })).toBe(
      `${repo.origin}/sample/project/pulls/12`
    )
    expect(fileUrl(repo, repo.ref, 'src/sample.ts')).toBe(
      `${repo.origin}/sample/project/src/commit/${repo.ref}/src/sample.ts`
    )
    expect(blobLink(repo, repo.ref, 'src/sample.ts', { from: 2, to: 3 }).url).toBe(
      `${repo.origin}/sample/project/src/commit/${repo.ref}/src/sample.ts#L2-L3`
    )
  })
  it.each([
    ['/sample/project', { kind: 'repo' }],
    ['/sample/project/issues/12', { kind: 'issue', number: 12 }],
    ['/sample/project/issues', { kind: 'list', list: 'issues', query: '' }],
    ['/sample/project/pulls', { kind: 'list', list: 'pulls', query: '' }],
    ['/sample/project/pulls/12/files', { kind: 'pull', number: 12, tab: 'files' }],
    [
      '/sample/project/src/branch/feature%2Fone/src/main.ts#L3-L5',
      { kind: 'blob', rest: ['feature/one', 'src', 'main.ts'] },
    ],
    ['/sample/project/src/tag/v1', { kind: 'blob', rest: ['v1'] }],
  ])('parses native route %s', (path, target) => {
    expect(urls.parse(`https://forge.example.test/team${path}`)).toMatchObject({
      ...target,
      origin: 'https://forge.example.test/team',
      owner: 'sample',
      repo: 'project',
    })
  })
  it.each([
    'https://forge.example.test/teammate/sample/project',
    'http://forge.example.test/team/sample/project',
    'https://forge.example.test:8443/team/sample/project',
    'https://user:secret@forge.example.test/team/sample/project',
    'https://forge.example.test/team/sample/project?access_token=sample-secret',
    'https://forge.example.test/team/sample/project/blob/main/file.ts',
    'https://forge.example.test/team/sample/project/src/branch/main/%2e%2e/private',
  ])('refuses unsafe or foreign route %s', (url) => expect(urls.parse(url)).toBeNull())
  it('builds native immutable links without GitHub diff hashes', () => {
    expect(
      urls.file('sample/project', 'a'.repeat(40), 'src/sample file.ts', { from: 3, to: 5 })
    ).toBe(
      `https://forge.example.test/team/sample/project/src/commit/${'a'.repeat(40)}/src/sample%20file.ts#L3-L5`
    )
  })
})
