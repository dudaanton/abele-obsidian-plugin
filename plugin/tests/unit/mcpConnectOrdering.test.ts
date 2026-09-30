import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { McpClient, type McpRequest } from '@/ai/mcp/McpClient'
import { OperationDelays } from '../helpers/deferred'

function connecting(legacy: boolean) {
  const delays = new OperationDelays<'connect'>()
  const gate = delays.holdNext('connect')
  const methods: string[] = []
  const request: McpRequest = async ({ body }) => {
    const message = JSON.parse(body)
    methods.push(message.method)
    if (legacy && message.method === 'server/discover') {
      return { status: 404, headers: {}, text: '' }
    }
    if (message.method === (legacy ? 'initialize' : 'server/discover')) {
      await delays.take('connect')
    }
    return { status: 200, headers: {}, text: JSON.stringify({
      jsonrpc: '2.0', id: message.id,
      result: message.method === 'initialize' ? { protocolVersion: '2025-11-25' } : { content: [] },
    }) }
  }
  return { client: new McpClient({ url: 'https://sample.invalid/mcp', headers: {}, request }), gate, methods }
}

describe.each([false, true])('Stop during connection (legacy: %s)', (legacy) => {
  // BUG: ensureEra is awaited without observing the caller's cancellation signal.
  it.fails('settles the caller while discovery is still unanswered', async () => {
    const { client, gate } = connecting(legacy)
    const controller = new AbortController()
    let stopped = false
    const call = client.callTool('sample', {}, controller.signal).catch((error) => {
      stopped = /stopped/i.test(error.message)
    })
    try {
      await gate.entered
      controller.abort()
      await flushPromises()
      expect(stopped).toBe(true)
    } finally {
      gate.release()
      await call
    }
  })

  // BUG: withStop receives an already-started HTTP request before checking the aborted signal.
  it.fails('does not dispatch a stopped tool when the connection eventually completes', async () => {
    const { client, gate, methods } = connecting(legacy)
    const controller = new AbortController()
    const call = client.callTool('sample', {}, controller.signal)
    const rejected = expect(call).rejects.toThrow(/stopped/i)
    await gate.entered
    controller.abort()
    gate.release()
    await rejected
    expect(methods).not.toContain('tools/call')
  })
})
