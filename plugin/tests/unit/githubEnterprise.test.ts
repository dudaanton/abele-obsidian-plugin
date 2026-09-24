/**
 * GitHub Enterprise: the configured server, its token, and the links that should reach both.
 *
 * A link is read with the Enterprise token only when its host is the server's. Any difference in
 * how the two are written — case, `www.`, a port, a trailing dot, the server pasted as its API
 * address — used to send the request to api.github.com without the token, where a private
 * repository is simply "not found". Every shape below must land on the server, with the token.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { RequestUrlParam } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS, GITHUB_TOKEN_KEY_ID } from '@/github/settings'
import {
  githubClient,
  githubHosts,
  parseForSettings,
  resetGithubClients,
} from '@/github/GithubService'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import { useVault } from '../helpers/testEnv'

const SERVERS = [
  'https://github.corp.example',
  'github.corp.example',
  'https://GitHub.Corp.Example/',
  'https://github.corp.example/api/v3',
  'https://github.corp.example/api/v3/',
  'https://github.corp.example.',
  '  https://github.corp.example  ',
  'https://github.corp.example/some-org',
]

const LINKS = [
  'https://github.corp.example/acme/app/pull/12',
  'https://GITHUB.corp.example/acme/app/pull/12',
  'https://www.github.corp.example/acme/app/pull/12',
  'https://github.corp.example./acme/app/pull/12',
  'http://github.corp.example/acme/app/pull/12',
]

function configure(server: string) {
  const app = useVault([])
  resetGithubClients()
  app.secretStorage.setSecret(GITHUB_TOKEN_KEY_ID, 'github_pat_x')
  AbeleConfig.getInstance().github = {
    ...DEFAULT_GITHUB_SETTINGS,
    enabled: true,
    keyId: GITHUB_TOKEN_KEY_ID,
    server,
  }
}

describe('the server setting, however it is written', () => {
  for (const server of SERVERS) {
    it(`"${server}" is the server at github.corp.example`, () => {
      expect(endpoints(server)).toMatchObject({
        webHost: 'github.corp.example',
        api: 'https://github.corp.example/api/v3',
      })
    })
  }

  it('matches links with or without www., and asks the API at the address given', () => {
    expect(endpoints('https://www.github.corp.example')).toMatchObject({
      webHost: 'github.corp.example',
      api: 'https://www.github.corp.example/api/v3',
    })
  })

  it('keeps a port in the API address', () => {
    expect(endpoints('https://github.corp.example:8443').api).toBe(
      'https://github.corp.example:8443/api/v3'
    )
  })

  it('a data-residency host, written as its web or its API address', () => {
    for (const server of ['acme.ghe.com', 'https://api.acme.ghe.com/', 'https://ACME.ghe.com']) {
      expect(endpoints(server)).toMatchObject({
        webHost: 'acme.ghe.com',
        api: 'https://api.acme.ghe.com',
      })
    }
  })

  it('an address on github.com itself is github.com', () => {
    for (const server of ['https://github.com/acme', 'api.github.com', 'https://www.github.com']) {
      expect(endpoints(server).api).toBe('https://api.github.com')
    }
  })
})

describe('links to the server are read from it, with the token', () => {
  beforeEach(() => configure('https://github.corp.example/api/v3'))

  for (const link of LINKS) {
    it(link, () => {
      const target = parseForSettings(link)
      expect(target?.host).toBe('github.corp.example')
      const client = githubClient(target!.host)
      expect(client.endpoints.api).toBe('https://github.corp.example/api/v3')
      expect(client.hasToken).toBe(true)
    })
  }

  it('a link with the port the server was given', () => {
    configure('https://github.corp.example:8443')
    const target = parseForSettings('https://github.corp.example:8443/acme/app/issues/3')
    expect(githubClient(target!.host).hasToken).toBe(true)
  })

  it('github.com is recognised beside the server, and read without its token', () => {
    expect(githubHosts()).toEqual(['github.com', 'github.corp.example'])
    const client = githubClient('github.com')
    expect(client.endpoints.api).toBe('https://api.github.com')
    expect(client.hasToken).toBe(false)
  })
})

describe('what is sent to an Enterprise Server', () => {
  const sent = async (server: string) => {
    const calls: RequestUrlParam[] = []
    const client = new GithubClient(endpoints(server), 'github_pat_x', async (r) => {
      calls.push(r)
      return { status: 200, headers: {}, json: {}, text: '{}' } as never
    })
    await client.get('/x')
    return calls[0].headers ?? {}
  }

  it('no API version header — a server older than 3.9 refuses one it does not know', async () => {
    expect(await sent('https://github.corp.example')).not.toHaveProperty('X-GitHub-Api-Version')
  })

  it('github.com and ghe.com still get it', async () => {
    expect(await sent('')).toHaveProperty('X-GitHub-Api-Version', '2022-11-28')
    expect(await sent('acme.ghe.com')).toHaveProperty('X-GitHub-Api-Version', '2022-11-28')
  })
})

describe('a request that went without the token does not blame the token', () => {
  it('names why no token was sent', async () => {
    configure('https://github.corp.example')
    const client = githubClient('github.com')
    const request = client as unknown as { request: unknown }
    request.request = async () =>
      ({ status: 404, headers: {}, json: { message: 'Not Found' }, text: '' }) as never
    const error = await client.get('/repos/acme/app').catch((e: Error) => e)
    expect(String(error)).toMatch(/No token was sent/)
    expect(String(error)).toMatch(/github\.corp\.example/)
    expect(String(error)).not.toMatch(/token cannot see/)
  })
})
