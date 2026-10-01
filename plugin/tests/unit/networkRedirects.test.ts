import { afterEach, describe, expect, it, vi } from 'vitest'
import { request, setRequestTransport } from '@/helpers/http'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'

const reply = (status: number, location?: string): RequestUrlResponse => ({
  status,
  headers: location ? { location } : {},
  text: '',
  json: {},
  arrayBuffer: new ArrayBuffer(0),
})
afterEach(() => setRequestTransport(undefined))

describe('credential redirects', () => {
  it('drops credentials on another origin and never restores them later', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(reply(302, 'https://other.example/next'))
      .mockResolvedValueOnce(reply(302, 'https://api.example/back'))
      .mockResolvedValue(reply(200))
    setRequestTransport(send)
    await request({
      url: 'https://api.example/start',
      headers: {
        Authorization: 'Bearer sample-key',
        'X-Api-Key': 'sample-key',
        Accept: 'application/json',
      },
    })
    expect(send.mock.calls[1][0].headers).toEqual({ Accept: 'application/json' })
    expect(send.mock.calls[2][0].headers).toEqual({ Accept: 'application/json' })
  })
  it('keeps credentials on a same-origin redirect', async () => {
    const send = vi.fn().mockResolvedValueOnce(reply(307, '/next')).mockResolvedValue(reply(200))
    setRequestTransport(send)
    await request({
      url: 'https://api.example/start',
      headers: { Authorization: 'Bearer sample-key' },
    })
    expect(send.mock.calls[1][0].headers.Authorization).toBe('Bearer sample-key')
  })
  it.each(['https://other.example/?key=sample-key', 'https://other.example/?key=sample%2Dkey'])(
    'refuses credentials embedded in a redirected URL: %s',
    async (location) => {
      const send = vi.fn().mockResolvedValue(reply(302, location))
      setRequestTransport(send)
      await expect(
        request({ url: 'https://api.example/start', secretValues: ['sample-key'] })
      ).rejects.toThrow(/key|credential/i)
      expect(send).toHaveBeenCalledTimes(1)
    }
  )
  it('does not resend a credential-bearing POST body to another origin', async () => {
    const send = vi.fn().mockResolvedValue(reply(307, 'https://other.example/'))
    setRequestTransport(send)
    await expect(
      request({
        url: 'https://api.example/',
        method: 'POST',
        body: 'key=sample-key',
        secretValues: ['sample-key'],
      })
    ).rejects.toThrow(/key|credential/i)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('turns a POST 302 into a GET without body headers', async () => {
    const send = vi.fn().mockResolvedValueOnce(reply(302, '/next')).mockResolvedValue(reply(200))
    setRequestTransport(send)
    await request({
      url: 'https://api.example/',
      method: 'POST',
      body: 'sample',
      contentType: 'text/plain',
      headers: { 'Content-Length': '6', 'Content-Type': 'text/plain' },
    })
    expect(send.mock.calls[1][0]).toMatchObject({
      method: 'GET',
      body: undefined,
      contentType: undefined,
      headers: {},
    })
  })
  it('does not strip a URL key by forwarding it to another host', async () => {
    const send = vi.fn().mockResolvedValue(reply(307, 'https://other.example/'))
    setRequestTransport(send)
    // Custom header substitutions use explicit values, not just known auth header names.
    const promise = request({
      url: 'https://api.example/',
      headers: { 'X-Custom': 'sample-key' },
      secretValues: ['sample-key'],
      maxRedirects: 1,
    })
    await expect(promise).rejects.toThrow(/redirect/i)
    expect((send.mock.calls[1][0] as RequestUrlParam).headers).toEqual({})
  })
})
