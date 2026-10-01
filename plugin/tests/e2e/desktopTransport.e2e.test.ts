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
  proxyUrl: string
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
      const remote = require('@electron/remote')
      const session = remote.session.fromPartition('abele-tls-probe-' + require('crypto').randomBytes(8).toString('hex'), { cache: false })
      const fetch = window.__abeleTest.syncTransport({})
      const secureFetch = window.__abeleTest.desktopTransport(session)
      let untrustedRejected = false
      try { await fetch(fixture.secureUrl + '/ok') } catch { untrustedRejected = true }
      // Trust ONLY the exact synthetic certificate in an isolated probe session.
      session.setCertificateVerifyProc((request, callback) => callback(
        request.hostname === '127.0.0.1' && request.certificate.data.trim() === fixture.cert.trim() ? 0 : -3
      ))
      try {
        const secureControl = await secureFetch(fixture.secureUrl + '/ok')
        const cases = []
        for (const status of [301, 302, 303, 307, 308]) {
          for (const [base, target] of [[fixture.sourceUrl, 'same'], [fixture.sourceUrl, 'cross'], [fixture.secureUrl, 'downgrade']]) {
            try {
              await (base === fixture.secureUrl ? secureFetch : fetch)(base + '/redirect/' + status + '/' + target, {
                method: 'POST', headers: { authorization: 'Bearer sample-device', 'content-type': 'application/json' },
                body: JSON.stringify({ password: 'sample-password' }), redirect: 'follow',
              })
              cases.push({ status, target, rejected: false })
            } catch (error) {
              cases.push({ status, target, rejected: /refuses redirects/.test(String(error)), error: String(error) })
            }
          }
        }
        return { cases, untrustedRejected, secureControl: secureControl.status }
      } finally {
        session.setCertificateVerifyProc(null)
        await session.closeAllConnections()
        await session.clearCache()
        await session.clearStorageData()
      }
    })()`)
    console.info(JSON.stringify(result, null, 2))
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

  it('routes through the selected session fixed proxy and PAC without changing shared app proxy settings', async () => {
    const result = cli().evalAwait<any>(`(async () => {
      const fixture = ${JSON.stringify(fixture)}
      const remote = require('@electron/remote')
      const session = remote.session.fromPartition('abele-proxy-probe-' + require('crypto').randomBytes(8).toString('hex'), { cache: false })
      const fetch = window.__abeleTest.desktopTransport(session)
      const results = []
      try {
        for (const mode of ['fixed_servers', 'pac_script']) {
          await session.setProxy(mode === 'fixed_servers'
            ? { mode, proxyRules: fixture.proxyUrl, proxyBypassRules: '<-loopback>' }
            : { mode, pacScript: fixture.sourceUrl + '/proxy.pac' })
          const url = 'http://proxy-only.invalid/' + mode
          const route = await session.resolveProxy(url)
          const response = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer sample-proxy-device' }, body: 'sample-password' })
          results.push({ mode, route, status: response.status, body: await response.text() })
        }
        return results
      } finally {
        await session.closeAllConnections()
        await session.clearCache()
        await session.clearStorageData()
        await session.setProxy({ mode: 'direct' })
      }
    })()`)
    expect(result).toHaveLength(2)
    for (const row of result) {
      expect(row.route).toContain('PROXY')
      expect(row.status).toBe(200)
      expect(row.body).toBe('session proxy route')
    }
    const evidence = await (await globalThis.fetch(fixture.sourceUrl + '/evidence')).json()
    expect(
      evidence
        .filter((row: any) => row.origin === 'proxy')
        .map((row: any) => ({
          path: row.path,
          method: row.method,
          hasCredential: row.hasCredential,
          hasPassword: row.hasPassword,
        }))
    ).toEqual(
      ['fixed_servers', 'pac_script'].map((mode) => ({
        path: 'http://proxy-only.invalid/' + mode,
        method: 'POST',
        hasCredential: true,
        hasPassword: true,
      }))
    )
    console.info(JSON.stringify({ proxy: result }, null, 2))
  })

  it('preserves binary windows and native cancellation through the main-process bridge', () => {
    const result = cli().evalAwait<any>(`(async () => {
      const fetch = window.__abeleTest.syncTransport({})
      const base = ${JSON.stringify(fixture.sourceUrl)}
      const bytes = new Uint8Array([1, 2, 3, 4, 5]).subarray(1, 4)
      const response = await fetch(base + '/bytes', { method: 'PUT', body: bytes, headers: { 'content-type': 'application/octet-stream' } })
      const controller = new AbortController()
      const request = fetch(base + '/slow', { signal: controller.signal })
      setTimeout(() => controller.abort(), 50)
      let aborted = false
      try { await request } catch (error) { aborted = /abort/i.test(String(error)) }
      return { bytes: [...new Uint8Array(await response.arrayBuffer())], header: response.headers.get('x-sample'), aborted }
    })()`)
    expect(result).toEqual({ bytes: [2, 3, 4], header: 'round-trip', aborted: true })
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
