/**
 * Every address the plugin writes for GitHub — a copied link, a snippet's link, "Open file", a
 * search result, a link an agent is given — starts with the server's real origin: its scheme and
 * port as the Server setting names them, `https://github.com` for github.com. An Enterprise Server
 * at `http://host:8080` wrote `https://host/…`, which opens nothing outside Obsidian.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { endpoints, parseGithubUrl } from '@/github/urls'
import { webOrigin } from '@/github/origin'
import { blobLink, commentLink, diffLink, fileUrl, itemUrl } from '@/github/permalinks'
import { hrefAction, imageSource, rawUrl } from '@/github/markdownLinks'
import { blobUrl, webBase } from '@/github/search/tabCode'
import { webUrl } from '@/ai/tools/github/shared'
import { parseForSettings } from '@/github/GithubService'
import { useVault } from '../helpers/testEnv'

const SHA = 'a'.repeat(40)
const server = (address: string) => {
  AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true, server: address }
}

beforeEach(() => {
  useVault([])
  server('')
})

describe('the origin of a server', () => {
  it('is the address as set, with its scheme and port, for an Enterprise Server', () => {
    expect(endpoints('http://git.example.com:8080').origin).toBe('http://git.example.com:8080')
    expect(endpoints('https://Git.Example.com/api/v3').origin).toBe('https://git.example.com')
    expect(endpoints('git.example.com:8443').origin).toBe('https://git.example.com:8443')
  })

  it('is https for github.com and a data-residency cloud', () => {
    expect(endpoints('').origin).toBe('https://github.com')
    expect(endpoints('acme.ghe.com').origin).toBe('https://acme.ghe.com')
    expect(endpoints('api.acme.ghe.com').origin).toBe('https://acme.ghe.com')
  })

  it('is looked up by the host a link carries', () => {
    server('http://git.example.com:8080')
    expect(webOrigin('git.example.com')).toBe('http://git.example.com:8080')
    expect(webOrigin('GIT.example.com')).toBe('http://git.example.com:8080')
    expect(webOrigin('github.com')).toBe('https://github.com')
    server('acme.ghe.com')
    expect(webOrigin('acme.ghe.com')).toBe('https://acme.ghe.com')
  })
})

describe('the links the plugin writes', () => {
  const repo = { host: 'git.example.com', owner: 'o', repo: 'r' }
  const O = 'http://git.example.com:8080'

  beforeEach(() => server(O))

  it('to an item, a comment, lines of a diff, lines of a file and a whole file', () => {
    const pull = { ...repo, kind: 'pull' as const, number: 7 }
    expect(itemUrl(pull)).toBe(`${O}/o/r/pull/7`)
    expect(commentLink(pull, { anchor: 'issuecomment-1', author: 'ann' }).url).toBe(
      `${O}/o/r/pull/7#issuecomment-1`
    )
    expect(diffLink(pull, { path: 'a.ts', hash: 'h' }, { side: 'R', start: 2, end: 2 }).url).toBe(
      `${O}/o/r/pull/7/files#diff-hR2`
    )
    expect(blobLink(repo, SHA, 'a.ts', { from: 1, to: 2 }).url).toBe(
      `${O}/o/r/blob/${SHA}/a.ts#L1-L2`
    )
    expect(fileUrl(repo, SHA, 'a.ts')).toBe(`${O}/o/r/blob/${SHA}/a.ts`)
  })

  it('from a code search, and for an agent', () => {
    expect(webBase(repo)).toBe(`${O}/o/r`)
    expect(blobUrl(repo, SHA, 'a.ts', 3)).toBe(`${O}/o/r/blob/${SHA}/a.ts#L3`)
    expect(webUrl(repo)).toBe(`${O}/o/r`)
  })

  it('from a rendered markdown file: its relative links and its images', () => {
    const file = { ...repo, ref: 'main', path: 'docs/guide.md' }
    expect(hrefAction('other.md', file)).toEqual({
      kind: 'repo',
      url: `${O}/o/r/blob/main/docs/other.md`,
    })
    expect(rawUrl(file, ['img', 'a.png'])).toBe(`${O}/o/r/raw/main/img/a.png`)
    expect(imageSource(`${O}/o/r/blob/main/a.png`, file)).toEqual({
      src: `${O}/o/r/raw/main/a.png`,
    })
  })

  it('on github.com stay https://github.com', () => {
    const gh = { host: 'github.com', owner: 'o', repo: 'r' }
    expect(itemUrl({ ...gh, kind: 'issue', number: 1 })).toBe('https://github.com/o/r/issues/1')
    expect(webUrl(gh)).toBe('https://github.com/o/r')
  })
})

describe('a link to the server', () => {
  it('is recognised with its scheme and port, and read with the configured client', () => {
    server('http://git.example.com:8080')
    const t = parseForSettings('http://git.example.com:8080/o/r/pull/7')
    expect(t).toMatchObject({ host: 'git.example.com', kind: 'pull', number: 7 })
    expect(
      parseGithubUrl('https://git.example.com/o/r/issues/1', ['git.example.com'])
    ).toMatchObject({ kind: 'issue' })
  })
})
