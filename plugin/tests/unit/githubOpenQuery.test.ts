/**
 * What an input to the "Open on GitHub" picker is read as: a link a tab shows, a repository, a
 * number, or words — which may also be a branch or a commit.
 */
import { describe, it, expect } from 'vitest'
import { parseOpenQuery, type QueryContext } from '@/github/open/query'

const repo = { host: 'github.com', owner: 'octo-org', repo: 'octo-repo' }
const ctx: QueryContext = { hosts: ['github.com'], defaultHost: 'github.com', repo }
const enterprise: QueryContext = {
  hosts: ['github.com', 'github.example.com'],
  defaultHost: 'github.example.com',
  repo: null,
}

describe('a link', () => {
  it('to something a tab shows is opened as it is', () => {
    const q = parseOpenQuery('https://github.com/octo-org/octo-repo/pull/12/files', ctx)
    expect(q).toMatchObject({ kind: 'link', target: { kind: 'pull', number: 12 } })
  })

  it('is recognised without its scheme', () => {
    const q = parseOpenQuery('github.com/octo-org/octo-repo/issues/3', ctx)
    expect(q).toMatchObject({ kind: 'link', target: { kind: 'issue', number: 3 } })
  })

  it('to the configured server is ours too', () => {
    const q = parseOpenQuery('https://github.example.com/team/app/commit/abcdef1', enterprise)
    expect(q).toMatchObject({
      kind: 'link',
      target: { kind: 'commit', host: 'github.example.com' },
    })
  })

  it('to a repository front page, or a page of it no tab shows, is the repository', () => {
    expect(parseOpenQuery('https://github.com/octo-org/octo-repo', ctx)).toEqual({
      kind: 'repo-link',
      repo,
    })
    expect(parseOpenQuery('https://github.com/octo-org/octo-repo/pulls', ctx)).toMatchObject({
      kind: 'repo-link',
    })
  })

  it('to another host is refused by name, and one naming no repository as unreadable', () => {
    expect(parseOpenQuery('https://example.com/a/b/pull/1', ctx)).toEqual({
      kind: 'foreign',
      host: 'example.com',
    })
    expect(parseOpenQuery('https://github.com/octo-org', ctx)).toEqual({ kind: 'unreadable' })
  })
})

describe('a number', () => {
  it('bare or with # is in the picker’s repository', () => {
    expect(parseOpenQuery('#42', ctx)).toEqual({ kind: 'number', repo, number: 42 })
    expect(parseOpenQuery('42', ctx)).toEqual({ kind: 'number', repo, number: 42 })
  })

  it('after owner/repo is in that repository, on the configured server', () => {
    expect(parseOpenQuery('team/app#7', enterprise)).toEqual({
      kind: 'number',
      repo: { host: 'github.example.com', owner: 'team', repo: 'app' },
      number: 7,
    })
    expect(parseOpenQuery('team/app 7', enterprise)).toMatchObject({ kind: 'number', number: 7 })
  })

  it('without any repository has none', () => {
    expect(parseOpenQuery('#42', enterprise)).toEqual({ kind: 'number', repo: null, number: 42 })
  })

  it('zero is not a number anything has', () => {
    expect(parseOpenQuery('#0', ctx).kind).toBe('text')
  })
})

describe('anything else', () => {
  it('is words in the picker’s repository', () => {
    expect(parseOpenQuery('  fix login ', ctx)).toEqual({ kind: 'text', repo, text: 'fix login' })
  })

  it('after owner/repo is words in that repository', () => {
    expect(parseOpenQuery('team/app fix login', enterprise)).toEqual({
      kind: 'text',
      repo: { host: 'github.example.com', owner: 'team', repo: 'app' },
      text: 'fix login',
    })
  })

  it('shaped like owner/repo may be that repository, or a branch in the picker’s', () => {
    expect(parseOpenQuery('feat/login', ctx)).toEqual({
      kind: 'text',
      repo,
      text: 'feat/login',
      named: { host: 'github.com', owner: 'feat', repo: 'login' },
    })
  })

  it('owner.name/repo is a repository, not a host', () => {
    expect(parseOpenQuery('octo.org/repo', ctx)).toMatchObject({
      kind: 'text',
      named: { owner: 'octo.org', repo: 'repo' },
    })
  })

  it('nothing is empty', () => {
    expect(parseOpenQuery('   ', ctx)).toEqual({ kind: 'empty' })
  })
})

describe('a comparison', () => {
  it('as a link opens as it is', () => {
    const q = parseOpenQuery('https://github.com/octo-org/octo-repo/compare/main...dev', ctx)
    expect(q).toMatchObject({
      kind: 'link',
      target: { kind: 'compare', base: 'main', head: 'dev' },
    })
  })

  it('typed as base...head or base..head is a comparison in the repository', () => {
    expect(parseOpenQuery('main...feature/login', ctx)).toEqual({
      kind: 'compare',
      repo,
      base: 'main',
      head: 'feature/login',
      direct: false,
    })
    expect(parseOpenQuery('v1.0..v2.0', ctx)).toMatchObject({ kind: 'compare', direct: true })
    expect(parseOpenQuery('octocat/Hello-World master...test', ctx)).toMatchObject({
      kind: 'compare',
      repo: { owner: 'octocat', repo: 'Hello-World' },
      base: 'master',
      head: 'test',
    })
  })

  it('is not made of a version number or a sentence', () => {
    expect(parseOpenQuery('v1.2.3', ctx).kind).toBe('text')
    expect(parseOpenQuery('wait... what', ctx).kind).toBe('text')
  })
})
