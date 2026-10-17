import { describe, expect, it, vi } from 'vitest'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import { ForgejoClient } from '@/forge/forgejoClient'
import { deployment } from '@/forge/identity'
import type { HttpResponse, HttpTransport } from '@/forge/transport'

const response = (status = 200): HttpResponse => ({
  status,
  headers: {},
  text: '',
  json: { title: 'Sample private content' },
  arrayBuffer: new ArrayBuffer(0),
})
const base = 'https://git.example.test:8443/team'
function client(provider: 'github' | 'forgejo' | 'gitea', transport: HttpTransport) {
  if (provider === 'github') {
    const value = new GithubClient(
      endpoints('https://git.example.test:8443'),
      'invented-token',
      transport
    )
    return { get: () => value.get('/repos/sample/project'), retire: () => value.retire() }
  }
  let current = true
  const value = new ForgejoClient(
    deployment(provider, base),
    {
      connectionId: 'sample-reader',
      generation: 'sample-generation',
      assertCurrent: () => {
        if (!current) throw new Error('Connection retired')
      },
    },
    transport,
    'invented-token'
  )
  return {
    get: () => value.get('/repos/sample/project'),
    retire: () => {
      current = false
    },
  }
}

for (const provider of ['github', 'forgejo', 'gitea'] as const) {
  describe(`${provider} integrated authority boundary`, () => {
    if (provider !== 'github')
      it('names the selected native service in a refused request', async () => {
        const reader = client(provider, vi.fn<HttpTransport>().mockResolvedValue(response(404)))
        await expect(reader.get()).rejects.toThrow(
          `${provider === 'gitea' ? 'Gitea' : 'Forgejo'} refused the request (404).`
        )
      })

    it('rejects pending and previously read results after retirement', async () => {
      let complete!: (reply: HttpResponse) => void
      const http = vi.fn<HttpTransport>().mockResolvedValue(response())
      const reader = client(provider, http)
      await expect(reader.get()).resolves.toMatchObject({ title: 'Sample private content' })
      reader.retire()
      await expect(reader.get()).rejects.toThrow(/changed|retired/i)
      const freshHttp = vi.fn<HttpTransport>().mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve
          })
      )
      const fresh = client(provider, freshHttp)
      const late = fresh.get()
      fresh.retire()
      complete(response())
      await expect(late).rejects.toThrow(/changed|retired/i)
      expect(freshHttp).toHaveBeenCalledOnce()
    })

    it.each([
      'https://git.example.test:9443/team/api/v1/repos/sample/project',
      'https://git.example.test:8443/other/api/v1/repos/sample/project',
      'https://elsewhere.example.test/api/v1/repos/sample/project',
    ])('does not forward credentials to redirected destination %s', async (location) => {
      const http = vi
        .fn<HttpTransport>()
        .mockResolvedValue({ ...response(302), headers: { Location: location } })
      const reader = client(provider, http)
      await expect(reader.get()).rejects.toThrow()
      expect(http).toHaveBeenCalledOnce()
      expect(http.mock.calls[0][0].url).not.toBe(location)
    })

    it('does not expose private-token diagnostics from a transport failure', async () => {
      const http = vi
        .fn<HttpTransport>()
        .mockRejectedValue(new Error('PRIVATE-TOKEN: invented-token'))
      const reader = client(provider, http)
      const error = await reader.get().catch((failure: Error) => failure)
      expect(String(error)).not.toContain('invented-token')
      expect(JSON.stringify(error)).not.toContain('invented-token')
    })
  })
}
