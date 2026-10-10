// @vitest-environment node
import { expect, it } from 'vitest'
import { createServer, request, Agent } from 'node:http'
import { installFixtureHttpTrace } from '../e2e/helpers/syncFixtureHttpTrace.mjs'

it('records server arrivals and finishes without credentials and prevents phone socket reuse', async () => {
  const entries: Record<string, unknown>[] = []
  const restore = installFixtureHttpTrace(
    (entry: Record<string, unknown>) => entries.push(entry),
    true
  )
  const agent = new Agent({ keepAlive: true })
  const server = createServer((incoming, outgoing) => {
    incoming.resume()
    incoming.on('end', () => outgoing.end('ok'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as import('node:net').AddressInfo).port
  const send = () =>
    new Promise<string | undefined>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${port}/v2/commit?secret=private`,
        {
          agent,
          method: 'POST',
          headers: { Authorization: 'Bearer private' },
        },
        (response) => {
          response.resume()
          response.on('end', () => resolve(response.headers.connection))
        }
      )
      req.on('error', reject)
      req.end('private body')
    })
  try {
    expect(await send()).toBe('close')
    expect(await send()).toBe('close')
    const arrivals = entries.filter((one) => one.event === 'arrival')
    expect(arrivals).toHaveLength(2)
    expect(arrivals[0].connection).not.toBe(arrivals[1].connection)
    expect(entries.filter((one) => one.event === 'finish')).toHaveLength(2)
    expect(JSON.stringify(entries)).not.toContain('private')
    expect(entries[1]).toMatchObject({
      route: '/v2/commit',
      port,
      declaredBytes: 12,
      bodyComplete: true,
      status: 200,
    })
  } finally {
    agent.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    restore()
  }
})
