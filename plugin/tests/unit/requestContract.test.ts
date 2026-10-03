import { afterEach, describe, expect, it, vi } from 'vitest'
import { headerValue, requestText, setRequestTransport } from '@/helpers/http'
import { obsidianRequester, header } from '@/calendars/http'
import { obsidianRequest } from '@/ai/mcp/McpClient'

afterEach(() => setRequestTransport(undefined))

describe('shared text-request adapter contract', () => {
  it.each([200, 204, 400, 401, 429, 500])(
    'returns status %i unchanged for domain error handling',
    async (status) => {
      const transport = vi.fn(async () => ({
        status,
        headers: { 'Content-TYPE': 'text/plain' },
        text: 'sample body',
        arrayBuffer: new ArrayBuffer(0),
        get json() {
          throw new Error('not JSON')
        },
      }))
      setRequestTransport(transport)
      const input = {
        url: 'https://sample.example/api',
        method: 'POST',
        headers: { 'X-Sample': 'value' },
        body: 'sample request',
      }
      expect(await requestText(input)).toEqual({
        status,
        headers: { 'Content-TYPE': 'text/plain' },
        text: 'sample body',
      })
      expect(transport.mock.calls[0][0]).toMatchObject({ ...input, throw: false })
    }
  )

  it('keeps calendar header casing but normalizes MCP header names', async () => {
    setRequestTransport(async () => ({
      status: 200,
      headers: { 'Mcp-Session-Id': 'sample-session' },
      text: 'sample body',
      json: {},
      arrayBuffer: new ArrayBuffer(0),
    }))
    expect((await obsidianRequester({ url: 'https://sample.example/' })).headers).toEqual({
      'Mcp-Session-Id': 'sample-session',
    })
    expect(
      (
        await obsidianRequest({
          url: 'https://sample.example/',
          method: 'POST',
          headers: {},
          body: '',
        })
      ).headers
    ).toEqual({ 'mcp-session-id': 'sample-session' })
    expect(headerValue({ 'Content-Type': 'sample' }, 'content-type')).toBe('sample')
    expect(headerValue(undefined, 'missing')).toBeUndefined()
    expect(header({ status: 200, text: '', headers: {} }, 'missing')).toBe('')
  })

  it('returns empty text for an unreadable body but retains the transport error object', async () => {
    setRequestTransport(async () => ({
      status: 204,
      headers: {},
      get text() {
        throw new Error('binary body')
      },
      json: {},
      arrayBuffer: new ArrayBuffer(0),
    }))
    expect((await requestText({ url: 'https://sample.example/' })).text).toBe('')
    const failure = new Error('sample network failure')
    setRequestTransport(async () => {
      throw failure
    })
    await expect(requestText({ url: 'https://sample.example/' })).rejects.toBe(failure)
  })
})
