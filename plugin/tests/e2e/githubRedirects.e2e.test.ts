import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { isObsidianRunning, hasTestApi } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { targets, onPhone } from './helpers/target'
import { exposeToPhone } from './helpers/phone'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('GitHub redirect credential confinement', () => {
  let child: ChildProcess
  let origin: string
  const unexpose: (() => void)[] = []
  beforeAll(async () => {
    child = spawn(process.execPath, [join(__dirname, 'helpers/redirectServer.mjs')], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('redirect server did not start')), 5000)
      child.stdout!.on('data', (chunk: Buffer) => {
        const m = /listening (\d+) (\d+)/.exec(chunk.toString())
        if (m) {
          clearTimeout(timer)
          if (onPhone())
            for (const port of [Number(m[1]), Number(m[2])]) unexpose.push(exposeToPhone(port))
          resolve(`http://127.0.0.1:${m[1]}`)
        }
      })
    })
  })
  afterAll(() => {
    for (const stop of unexpose) stop()
    child?.kill()
  })

  it('records requestUrl redirect behaviour without revealing credentials', async () => {
    const result = evalAsync<{ statuses: number[] }>(`(async () => {
      const statuses = []
      for (const path of ['/same-origin', '/other-origin', '/other-host']) {
        const r = await window.__abeleTest.requestUrl({
          url: ${JSON.stringify(origin)} + path,
          headers: { Authorization: 'Bearer invented-redirect-token' }, throw: false,
        })
        statuses.push(r.status)
      }
      return { statuses }
    })()`)
    const seen = await (await globalThis.fetch(`${origin}/seen`)).json()
    console.log('requestUrl redirect behaviour', { ...result, seen })
    expect(result.statuses).toHaveLength(3)
  })

  it('sends GraphQL as a JSON object rather than a quoted JSON string through the platform adapter', () => {
    const result=evalAsync<{echo:string;variables:{name:string}}>(`(async()=>{
      const client = new window.__abeleTest.GithubClient(window.__abeleTest.githubEndpoints(${JSON.stringify(origin)}), 'invented-query-token')
      return await client.graphql('query { sample }',{name:'sample-variable'})
    })()`)
    expect(result).toEqual({echo:'query { sample }',variables:{name:'sample-variable'}})
  })

  it('the GitHub client never forwards its token through a cross-origin archive redirect', async () => {
    const before = (await (await globalThis.fetch(`${origin}/seen`)).json()).length
    const result = evalAsync<{ type?: string; bytes: number }>(`(async () => {
      const client = new window.__abeleTest.GithubClient(window.__abeleTest.githubEndpoints(${JSON.stringify(origin)}), 'invented-client-token')
      const r = await client.bytes('/other-origin')
      return { type: r.type, bytes: r.bytes.byteLength }
    })()`)
    expect(result.bytes).toBeGreaterThan(0)
    const seen = (await (await globalThis.fetch(`${origin}/seen`)).json()).slice(before)
    expect(seen).toEqual([
      { destination: 'original', path: '/api/v3/other-origin', authenticated: true },
      { destination: 'other-origin', path: '/landed', authenticated: false },
    ])
  })
})
