import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { vaultCli } from './helpers/obsidianCli'

interface Fixture {
  sourceUrl: string
  sinkUrl: string
  secureUrl: string
  cert: string
}
let fixture: Fixture
let child: ChildProcess | undefined
let dir = ''
const cli = () => {
  const vault = process.env.OBSIDIAN_TEST_VAULT
  if (!vault) throw new Error('Native probe requires an exclusively leased pool vault')
  return vaultCli(vault)
}

beforeAll(async () => {
  const scratch = fileURLToPath(new URL('../../../.scratch/transport/', import.meta.url))
  mkdirSync(scratch, { recursive: true })
  dir = mkdtempSync(scratch + 'fixture-')
  child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./helpers/redirectFixture.mjs', import.meta.url)), dir],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  fixture = await new Promise<Fixture>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Redirect fixture failed to start')), 15_000)
    let output = ''
    child!.stdout!.on('data', (chunk) => {
      output += String(chunk)
      if (!output.includes('\n')) return
      clearTimeout(timer)
      try {
        resolve(JSON.parse(output.trim()))
      } catch (error) {
        reject(error)
      }
    })
    child!.once('error', reject)
    child!.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error('Redirect fixture exited: ' + code))
    })
  })
  expect(cli().evalAwait<boolean>('typeof window.__abeleTest?.syncTransport === "function"')).toBe(
    true
  )
})

afterAll(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit')
    child.kill('SIGTERM')
    const force = setTimeout(() => child?.kill('SIGKILL'), 5_000)
    try {
      await ended
    } finally {
      clearTimeout(force)
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('native desktop non-following production adapter', () => {
  it('rejects same-origin, cross-origin and HTTPS downgrade redirects before a second listener receives anything', async () => {
    const result = cli().evalAwait<any>(`(async () => {
      const fixture = ${JSON.stringify(fixture)}
      const https = require('node:https')
      const before = https.globalAgent
      const fetch = window.__abeleTest.syncTransport({})
      let untrustedRejected = false
      try { await fetch(fixture.secureUrl + '/ok') } catch { untrustedRejected = true }
      // Trust ONLY the synthetic listener certificate for this probe. Never disable TLS validation.
      https.globalAgent = new https.Agent({ ca: fixture.cert })
      try {
        const secureControl = await fetch(fixture.secureUrl + '/ok')
        const cases = []
        for (const status of [301, 302, 303, 307, 308]) {
          for (const [base, target] of [[fixture.sourceUrl, 'same'], [fixture.sourceUrl, 'cross'], [fixture.secureUrl, 'downgrade']]) {
            try {
              await fetch(base + '/redirect/' + status + '/' + target, {
                method: 'POST', headers: { authorization: 'Bearer sample-device', 'content-type': 'application/json' },
                body: JSON.stringify({ password: 'sample-password' }), redirect: 'follow',
              })
              cases.push({ status, target, rejected: false })
            } catch (error) {
              cases.push({ status, target, rejected: /refuses redirects/.test(String(error)) })
            }
          }
        }
        return { cases, untrustedRejected, secureControl: secureControl.status }
      } finally {
        https.globalAgent.destroy()
        https.globalAgent = before
      }
    })()`)
    expect(result.untrustedRejected).toBe(true)
    expect(result.secureControl).toBe(200)
    expect(result.cases).toHaveLength(15)
    expect(result.cases.every((entry: any) => entry.rejected)).toBe(true)
    const evidence = await (await globalThis.fetch(fixture.sourceUrl + '/evidence')).json()
    console.info(JSON.stringify({ result, evidence }, null, 2))
    expect(evidence.filter((entry: any) => entry.path === '/sink')).toEqual([])
    expect(evidence.filter((entry: any) => entry.path.startsWith('/redirect/'))).toHaveLength(15)
    expect(
      evidence
        .filter((entry: any) => entry.path.startsWith('/redirect/'))
        .every((entry: any) => entry.hasCredential && entry.hasPassword)
    ).toBe(true)
  })

  it('does not reuse cached-looking responses across credentials in the native window', () => {
    const result = cli().evalAwait<any>(`(async () => {
      const fetch = window.__abeleTest.syncTransport({})
      const url = ${JSON.stringify(fixture.sourceUrl + '/cache')}
      const first = await fetch(url, { headers: { authorization: 'Bearer sample-first' } })
      const second = await fetch(url, { headers: { authorization: 'Bearer sample-second' } })
      const head = await fetch(url, { method: 'HEAD', headers: { authorization: 'Bearer sample-second' } })
      return { first: first.status, firstBody: await first.text(), second: second.status, secondBody: await second.text(), head: head.status }
    })()`)
    expect(result).toEqual({
      first: 200,
      firstBody: 'first',
      second: 403,
      secondBody: 'second',
      head: 403,
    })
  })
})
