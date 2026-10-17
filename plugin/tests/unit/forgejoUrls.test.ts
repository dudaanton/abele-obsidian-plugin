import { describe, expect, it } from 'vitest'
import { forgejoUrls } from '@/forge/forgejoUrls'
import { deployment } from '@/forge/identity'

const urls = forgejoUrls(deployment('forgejo', 'https://forge.example.test/team'))
describe('Forgejo links', () => {
  it.each([
    ['/sample/project', { kind: 'repo' }],
    ['/sample/project/issues/12', { kind: 'issue', number: 12 }],
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
