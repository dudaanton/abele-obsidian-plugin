/**
 * What a refused GitHub request is turned into.
 *
 * An organisation refuses a token in half a dozen ways that all arrive as a 403 or a 404, and
 * each needs a different fix. The messages below are GitHub's own wording, as its API sends it;
 * each has to come out as the cause first, what to do second, and GitHub's words kept beside
 * them so nothing is lost in the translation.
 */
import { describe, it, expect } from 'vitest'
import { errorFor, GithubClient } from '@/github/client'
import { neededPermissions, tokenKind } from '@/github/refusal'
import { endpoints } from '@/github/urls'

const refuse = (
  message: string,
  headers: Record<string, string> = {},
  what = "the pull request's reviews"
) => errorFor(403, headers, { message }, true, what)

describe('the permission a request needed', () => {
  it('names one permission', () => {
    expect(neededPermissions('issues=read')).toBe('Issues (read)')
  })

  it('names alternatives, any one of which would do', () => {
    expect(neededPermissions('issues=read; pull_requests=read')).toBe(
      'Issues (read) or Pull requests (read)'
    )
  })

  it('names permissions that are needed together', () => {
    expect(neededPermissions('contents=read,metadata=read')).toBe(
      'Contents (read) and Metadata (read)'
    )
  })

  it('says nothing for a request that needs no permission', () => {
    expect(neededPermissions('allows_permissionless_access=true')).toBeUndefined()
    expect(neededPermissions(undefined)).toBeUndefined()
  })
})

describe('organisation refusals lead with the cause', () => {
  it('"Resource not accessible by personal access token": permission, repository list or resource owner', () => {
    const e = refuse('Resource not accessible by personal access token', {
      'X-Accepted-GitHub-Permissions': 'pull_requests=read',
    })
    expect(e.kind).toBe('forbidden')
    expect(e.message.split('\n')[0]).toMatch(/^GitHub refused .*the pull request's reviews/)
    expect(e.message).toMatch(/Resource owner/)
    expect(e.message).toMatch(/not among the repositories/)
    expect(e.needed).toBe('Pull requests (read)')
    expect(e.message).toContain('Needs: Pull requests (read)')
    expect(e.message).toContain('GitHub said: "Resource not accessible by personal access token"')
  })

  it('the IP allow list names the address, not the token', () => {
    const e = refuse(
      'Although you appear to have the correct authorization credentials, the `acme` organization has an IP allow list enabled, and your IP address is not permitted to access this resource.'
    )
    expect(e.kind).toBe('ip-allow-list')
    expect(e.message.split('\n')[0]).toMatch(
      /acme only accepts requests from its allowed IP addresses/
    )
    expect(e.message).toMatch(/VPN/)
  })

  it('a token that lives longer than the organisation allows', () => {
    const e = refuse(
      "The 'acme' organization forbids access via a fine-grained personal access tokens if the token's lifetime is greater than 366 days. Please adjust your token's lifetime at the following URL: https://github.com/settings/personal-access-tokens/123"
    )
    expect(e.kind).toBe('policy')
    expect(e.message.split('\n')[0]).toMatch(/longer than it allows \(366 days\)/)
    expect(e.message).toMatch(/Shorten the token's expiration/)
    expect(e.message).toContain('https://github.com/settings/personal-access-tokens/123')
  })

  it('an organisation that forbids fine-grained tokens altogether', () => {
    const e = refuse(
      'acme forbids access via a personal access token with fine-grained permissions. Please use a GitHub App, or an OAuth App.'
    )
    expect(e.kind).toBe('policy')
    expect(e.message.split('\n')[0]).toMatch(/does not accept fine-grained personal access tokens/)
  })

  it('an organisation that forbids classic tokens', () => {
    const e = refuse(
      'acme forbids access via a personal access token (classic). Please use a GitHub App, OAuth App, or a personal access token with fine-grained permissions.'
    )
    expect(e.kind).toBe('policy')
    expect(e.message.split('\n')[0]).toMatch(/does not accept classic personal access tokens/)
    expect(e.message).toMatch(/fine-grained token instead/)
  })

  it('single sign-on by header keeps its link', () => {
    const e = errorFor(
      403,
      { 'X-GitHub-SSO': 'required; url=https://github.com/orgs/acme/sso?authorization_request=1' },
      { message: 'Resource protected by organization SAML enforcement.' },
      true
    )
    expect(e.kind).toBe('sso')
    expect(e.message).toContain('https://github.com/orgs/acme/sso?authorization_request=1')
  })

  it('single sign-on by message alone, as GraphQL sends it', () => {
    const e = refuse(
      'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.'
    )
    expect(e.kind).toBe('sso')
  })

  it('an unknown 403 still shows what GitHub said, and which request', () => {
    const e = refuse('Something new', {}, 'the issue')
    expect(e.kind).toBe('forbidden')
    expect(e.message.split('\n')[0]).toMatch(/the issue/)
    expect(e.message).toContain('GitHub said: "Something new"')
  })
})

describe('not found', () => {
  it('with a token: the repository selection and the resource owner', () => {
    const e = errorFor(404, {}, { message: 'Not Found' }, true, 'the pull request')
    expect(e.kind).toBe('not-found')
    expect(e.message.split('\n')[0]).toMatch(/found nothing for the pull request/)
    expect(e.message).toMatch(/Resource owner is the organisation/)
    expect(e.message).toMatch(/approved/)
  })

  it('without a token: add one', () => {
    expect(errorFor(404, {}, null, false).message).toMatch(/add a token/)
  })

  it('an empty repository is not a refusal', () => {
    const e = errorFor(404, {}, { message: 'This repository is empty.' }, true, 'the files')
    expect(e.kind).toBe('empty')
  })
})

describe('the token', () => {
  it('is told apart by its prefix', () => {
    expect(tokenKind('github_pat_11AAA')).toBe('fine-grained')
    expect(tokenKind('ghp_abc')).toBe('classic')
    expect(tokenKind('')).toBe('none')
  })

  it('is trimmed before it is sent — a pasted newline is not part of it', async () => {
    const calls: Record<string, string>[] = []
    const client = new GithubClient(endpoints(''), '  github_pat_x\n', async (r) => {
      calls.push(r.headers ?? {})
      return { status: 200, headers: {}, json: {}, text: '{}' } as never
    })
    await client.get('/x')
    expect(calls[0].Authorization).toBe('Bearer github_pat_x')
    expect(client.tokenInfo).toEqual({ attached: true, length: 12, kind: 'fine-grained' })
  })
})
