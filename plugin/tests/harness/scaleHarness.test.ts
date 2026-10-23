// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { gzipSync } from 'node:zlib'
import { runInNewContext } from 'node:vm'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { planVault, contentChunk, shapes } from '../scale/generate.mjs'
import {
  compareInventory,
  budgets,
  pauseMetrics,
  noticeDetails,
  startupTiming,
  expectedSet,
  comparePeer,
  markdown,
  compareReports,
  attributePauseRequests,
} from '../scale/oracles.mjs'
import { WireProxy } from '../scale/proxy.mjs'
import { RealVault } from '../scale/run.mjs'

describe('scale harness independent guarantees', () => {
  it('matches each pause request to its nearest preceding caller once, without guessing missing callers', () => {
    const starts = [110, 210, 220].map((at) => ({
      device: '0',
      method: 'GET',
      route: '/v2/changes',
      at,
      component: null,
    }))
    attributePauseRequests(
      starts,
      [100, 200].map((at) => ({
        device: '0',
        method: 'GET',
        route: '/v2/changes',
        at,
        stack: `sample-${at}`,
      }))
    )
    expect(starts.map((row) => row.callerStack ?? null)).toEqual(['sample-100', 'sample-200', null])
  })
  it('compares clocks explicitly and leaves missing baseline product timing unknown', () => {
    const rows = compareReports(
      { restartRequestMs: 5200, budgets: [{ name: 'notices', value: 5, status: 'FAIL' }] },
      {
        startupClock: 'plugin-load',
        restartRequestMs: 5100,
        restartPluginRequestMs: 100,
        budgets: [{ name: 'notices', value: 0, status: 'PASS' }],
      }
    )
    expect(rows.find((row) => row.metric === 'First request from plugin load (ms)')).toMatchObject({
      master: null,
      candidate: 100,
    })
    expect(rows.find((row) => row.metric === 'First request from app launch (ms)')).toMatchObject({
      master: 5200,
      candidate: 5100,
    })
    expect(rows.find((row) => row.metric === 'notices')).toMatchObject({
      master: '5 (FAIL)',
      candidate: '0 (PASS)',
    })
  })
  it('budgets restart from product onload while retaining launch timing', () => {
    const timing = startupTiming(1000, 6200, [{ event: 'plugin-load', at: 6000 }], 6500)
    expect(timing).toMatchObject({
      launchToFirstRequestMs: 5200,
      pluginLoadToFirstRequestMs: 200,
      pluginLoadToIdleMs: 500,
    })
    expect(
      budgets({
        restartRequestMs: 5200,
        restartIdleMs: 5500,
        restartPluginRequestMs: 200,
        restartPluginIdleMs: 500,
        startupClock: 'plugin-load',
      }).find((r) => r.name === 'restart first request').status
    ).toBe('PASS')
    expect(
      budgets({ restartRequestMs: 200, startupClock: 'plugin-load' }).find(
        (r) => r.name === 'restart first request'
      ).status
    ).toBe('FAIL')
  })
  it('observes the existing product performance mark without wrapping product onload', async () => {
    const evidence = [],
      registrations = []
    const source = await readFile(new URL('../scale/observer.cjs', import.meta.url), 'utf8')
    const module = { exports: null }
    runInNewContext(source, {
      module,
      performance: { timeOrigin: 1000 },
      console: { debug() {} },
      window: {},
      URL,
      Error,
      require: (name) =>
        name === 'obsidian'
          ? {
              Plugin: class {
                app = { vault: { adapter: { getBasePath: () => '/sample' } } }
                register() {}
              },
            }
          : name === 'fs'
            ? {
                readFileSync: () => JSON.stringify({ device: '0', evidence: 'sample' }),
                appendFileSync: (_path, value) => evidence.push(JSON.parse(value)),
              }
            : { join: (...parts) => parts.join('/') },
      document: { body: {}, querySelectorAll: () => [] },
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
      PerformanceObserver: class {
        constructor(callback) {
          this.callback = callback
        }
        observe(options) {
          registrations.push(options)
          if (options.type === 'mark')
            this.callback({
              getEntries: () => [
                { name: 'abele:onload-start', startTime: 250 },
                { name: 'unrelated', startTime: 300 },
              ],
            })
        }
        disconnect() {}
      },
    })
    new module.exports().onload()
    expect(evidence.filter((row) => row.event === 'plugin-load')).toMatchObject([
      { at: 1250, device: '0', source: 'abele:onload-start' },
    ])
    expect(registrations).toContainEqual({ type: 'mark', buffered: true })
  })
  it('reads configured policy and exact refusals from the primary UI', async () => {
    const vault = new RealVault({}, '/sample-vault')
    const app = {
      vault: {
        configDir: '.prefs',
        adapter: { exists: async () => true, read: async () => 'Private/' },
      },
      plugins: {
        plugins: {
          abele: {
            tokenEngines: {
              ui: {
                registry: { records: () => [{ selective: { excludedFolders: ['Private'] } }] },
                activity: {
                  value: {
                    sample: {
                      refused: [{ path: 'Notes/case.md', reason: 'Case collision' }],
                      events: [
                        {
                          at: 42,
                          text: 'scan: held Notes/case.md: Notes/Case.md is synced under the same name but for case; rename one of them to sync both',
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
    vault.evaluate = async (body) => runInNewContext(`(async()=>{${body}})()`, { app })
    expect(await vault.policy()).toMatchObject({
      configDir: '.prefs',
      ignoreText: 'Private/',
      selective: { excludedFolders: ['Private'] },
    })
    expect(await vault.refusals()).toMatchObject([
      { path: 'Notes/case.md', source: 'status' },
      { path: 'Notes/case.md', source: 'log', at: 42 },
    ])
  })
  it('captures notice text even when the DOM fills an initially empty notice later', async () => {
    const evidence = []
    const node = { textContent: '' }
    let observe
    const source = await readFile(new URL('../scale/observer.cjs', import.meta.url), 'utf8')
    const module = { exports: null }
    runInNewContext(source, {
      module,
      require: (name) =>
        name === 'obsidian'
          ? {
              Plugin: class {
                app = { vault: { adapter: { getBasePath: () => '/sample' } } }
                register() {}
              },
            }
          : name === 'fs'
            ? {
                readFileSync: () => JSON.stringify({ device: '0', evidence: 'sample' }),
                appendFileSync: (_path, value) => evidence.push(JSON.parse(value)),
              }
            : { join: (...parts) => parts.join('/') },
      document: { body: {}, querySelectorAll: () => [node] },
      MutationObserver: class {
        constructor(callback) {
          observe = callback
        }
        observe() {}
        disconnect() {}
      },
      PerformanceObserver: class {
        observe() {}
        disconnect() {}
      },
    })
    new module.exports().onload()
    node.textContent = 'Sample notice'
    observe()
    expect(evidence.filter((row) => row.event === 'notice')).toMatchObject([
      { text: 'Sample notice', device: '0' },
    ])
  })
  it('retains notice text, time and phase, including unavailable legacy text', () => {
    const details = noticeDetails(
      [
        { event: 'notice', at: 15, text: 'Sample warning' },
        { event: 'notice', at: 25 },
      ],
      [
        { name: 'pull', at: 10 },
        { name: 'pause', at: 20 },
      ]
    )
    expect(details[0]).toMatchObject({ text: 'Sample warning', at: 15, phase: 'pull' })
    expect(details[1]).toMatchObject({ text: null, phase: 'pause' })
    expect(markdown({ budgets: [], noticeDetails: details })).toContain('Sample warning')
  })
  it('splits pause traffic by endpoint and click-relative time without inventing a caller', () => {
    const result = pauseMetrics(
      [
        { event: 'start', id: 2, at: 1100, method: 'GET', route: '/v2/changes' },
        {
          event: 'start',
          id: 3,
          at: 2200,
          method: 'POST',
          route: '/v2/commit',
          contentCommit: true,
          component: 'sample',
        },
      ],
      1000,
      new Set(),
      new Set(),
      2500
    )
    expect(result.pauseRequests.map((r) => [r.afterPauseMs, r.kind, r.component])).toEqual([
      [100, 'metadata', null],
      [1200, 'content commit', 'sample'],
    ])
    expect(result.pauseByEndpoint.map((r) => r.count)).toEqual([1, 1])
  })
  it('keeps startup components unknown when no sync-start marker exists', () => {
    expect(startupTiming(1000, 6200, [{ event: 'renderer-start', at: 2000 }])).toMatchObject({
      launchToFirstRequestMs: 5200,
      pluginLoadToSyncStartMs: null,
      syncStartToFirstRequestMs: null,
    })
    expect(
      startupTiming(1000, 6200, [
        { event: 'renderer-start', at: 2000 },
        { event: 'sync-start', at: 3000 },
      ])
    ).toMatchObject({ pluginLoadToSyncStartMs: null, syncStartToFirstRequestMs: 3200 })
    expect(
      startupTiming(1000, 6200, [
        { event: 'plugin-load', at: 2000 },
        { event: 'sync-start', at: 3000 },
      ])
    ).toMatchObject({ pluginLoadToSyncStartMs: 1000, syncStartToFirstRequestMs: 3200 })
  })
  it('derives exclusions from settings and requires exact visible case refusals', () => {
    const files = [
      'Scope/Notes/Case.md',
      'Scope/Notes/case.md',
      'Scope/Private/a.md',
      'Scope/.prefs/a.json',
    ].map((path) => ({ path, sha: 'aa', size: 2 }))
    const set = expectedSet(files, {
      configDir: '.prefs',
      selective: { excludedFolders: ['Scope/Private'] },
    })
    expect(set.excluded.map((f) => f.path)).toEqual(['Scope/Private/a.md', 'Scope/.prefs/a.json'])
    expect(
      expectedSet(files, { configDir: '.prefs', selective: { excludedFolders: [] } }).synced
    ).toHaveLength(3)
    expect(comparePeer(set, [files[0]], [])).toEqual([{ path: files[1].path, kind: 'missing' }])
    expect(
      comparePeer(set, [files[0]], [{ path: files[0].path, reason: 'Case collision' }])
    ).toHaveLength(1)
    expect(
      comparePeer(set, [files[0]], [{ path: files[1].path, reason: 'Case collision' }])
    ).toEqual([])
    expect(
      comparePeer(set, [files[0], files[2]], [{ path: files[1].path, reason: 'Case collision' }])
    ).toContainEqual({ path: files[2].path, kind: 'extra' })
  })
  it('accepts a framed CLI reply even while a descendant keeps its output pipe open', async () => {
    const parent = join(process.cwd(), '.scratch')
    await mkdir(parent, { recursive: true })
    const root = await mkdtemp(join(parent, 'scale-cli-'))
    const cli = join(root, 'sample-cli.cjs'),
      pidFile = join(root, 'holder.pid')
    await writeFile(
      cli,
      `#!${process.execPath}\nconst fs=require('node:fs'),{spawn}=require('node:child_process');(async()=>{const code=process.argv.find(a=>a.startsWith('code=')).slice(5);const value=await eval(code);const holder=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});fs.writeFileSync(${JSON.stringify(pidFile)},String(holder.pid));fs.writeSync(1,'=> '+value+'\\n');process.exit(0)})()`,
      { mode: 0o755 }
    )
    const vault = new RealVault({ cli }, '/sample-vault')
    const operation = vault.evaluate('return true')
    operation.catch(() => {})
    let timer
    try {
      await expect(
        Promise.race([
          operation,
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Framed result was not returned')), 1500)
          }),
        ])
      ).resolves.toBe(true)
    } finally {
      clearTimeout(timer)
      const pid = Number(await readFile(pidFile, 'utf8').catch(() => 0))
      if (pid)
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* already exited */
        }
      await operation.catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })
  it('requires server verification to finish before byte equality can pass', () => {
    expect(
      budgets({ verifiedFiles: 1000, mismatches: [] }).find((row) => row.name === 'byte equality')
        .status
    ).toBe('FAIL')
  })
  it('reports a device error promptly instead of waiting for an idle timeout', async () => {
    const vault = new RealVault({}, '/sample-vault')
    vault.snapshot = async () => ({ rows: [{ status: 'error' }], engines: [] })
    await expect(vault.idle(5)).rejects.toThrow('Vault entered an error state')
  })
  it('cuts a content batch after the server applied it and before its acknowledgement reaches the client', async () => {
    let applied = false
    const upstream = createServer(async (req, res) => {
      for await (const _ of req) {
        /* drain metadata */
      }
      applied = true
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          results: [{ status: 'applied', version_id: 'sample-version', sha: 'c'.repeat(64) }],
        })
      )
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP fixture')
    const proxy = new WireProxy(`http://127.0.0.1:${address.port}`, 'sample-device')
    const url = await proxy.start()
    proxy.breakpoint = 'batch'
    const hit = new Promise((resolve) =>
      proxy.on('wire', (event) => {
        if (event.event === 'trigger') resolve(true)
      })
    )
    const transfer = globalThis
      .fetch(url + '/v2/commit', {
        method: 'POST',
        body: JSON.stringify({ ops: [{ sha: 'c'.repeat(64) }] }),
      })
      .then((r) => r.text())
      .catch(() => null)
    try {
      await hit
      expect(applied).toBe(true)
    } finally {
      proxy.release()
      await proxy.close()
      await transfer
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })
  it('fences a late failure from the job that a plugin reload retired', async () => {
    let reject!: (reason: Error) => void
    const pending = new Promise<void>((_resolve, fail) => {
      reject = fail
    })
    const window = {}
    const app = {
      plugins: {
        plugins: {
          abele: {
            tokenEngines: { ui: { rows: { value: [{ id: 'sample' }] }, sync: () => pending } },
          },
        },
      },
    }
    const vault = new RealVault({}, '/sample-vault')
    vault.evaluate = async (body) => runInNewContext(`(async()=>{${body}})()`, { app, window })
    await vault.sync()
    await vault.invalidateJob()
    reject(new Error('sample interrupted action'))
    await new Promise((resolve) => setImmediate(resolve))
    expect(window.__scaleJob).toBe(null)
  })
  it('does not report an unfinished paused request as zero stop latency', () => {
    const measured = pauseMetrics(
      [{ event: 'start', id: 1, at: 900 }],
      1000,
      new Set([1]),
      new Set([1]),
      3500
    )
    expect(measured.pauseLatencyMs).toBe(2500)
    expect(measured.pauseNewRequests).toBe(0)
    expect(measured.pauseInFlight).toBe(1)
    expect(budgets(measured).find((row) => row.name === 'pause latency').status).toBe('FAIL')
  })
  it('keeps only a few very large attachments in the full shape without generating its data', () => {
    const plan = planVault({ ...shapes.scale, seed: 42 })
    expect(plan.filter((file) => file.size > 100 * 1024 ** 2)).toHaveLength(3)
    expect(Math.max(...plan.map((file) => file.size))).toBeLessThanOrEqual(256 * 1024 ** 2)
    expect(plan.reduce((sum, file) => sum + file.size, 0)).toBe(shapes.scale.bytes)
  })
  it('reproduces exact count and bytes with a large attachment tail', () => {
    const a = planVault({ seed: 42, files: 1000, bytes: 200 * 1024 ** 2 })
    expect(a).toEqual(planVault({ seed: 42, files: 1000, bytes: 200 * 1024 ** 2 }))
    expect(a).toHaveLength(1000)
    expect(a.reduce((sum, file) => sum + file.size, 0)).toBe(200 * 1024 ** 2)
    expect(a.filter((file) => file.path.endsWith('.md')).length).toBeGreaterThan(850)
    expect(Math.max(...a.map((file) => file.size))).toBeGreaterThan(100 * 1024 ** 2)
    expect(new Set(a.map((file) => file.path)).size).toBe(a.length)
    expect(
      new Set(a.map((file) => file.path.slice(0, file.path.lastIndexOf('/')))).size
    ).toBeLessThan(150)
    expect(
      a.some((file) =>
        a.some(
          (other) =>
            file.path !== other.path && file.path.toLowerCase() === other.path.toLowerCase()
        )
      )
    ).toBe(true)
    expect(contentChunk(42, 1, 0)).toEqual(contentChunk(42, 1, 0))
    expect(contentChunk(42, 1, 0)).not.toEqual(contentChunk(43, 1, 0))
  })
  it('detects missing, extra and corrupt bytes independently of matching sizes', () => {
    const expected = [
      { path: 'a.md', size: 2, sha: 'aa' },
      { path: 'b.md', size: 2, sha: 'bb' },
    ]
    expect(
      compareInventory(expected, [
        { path: 'a.md', size: 2, sha: 'cc' },
        { path: 'c.md', size: 2, sha: 'bb' },
      ])
        .map((x) => x.kind)
        .sort()
    ).toEqual(['extra', 'missing', 'sha'])
  })
  it('never passes a missing observation or an untriggered interruption', () => {
    const result = budgets({ interruptions: [], mismatches: [], ownDownloads: 0 })
    expect(result.find((row) => row.name === 'restart first request').status).toBe('FAIL')
    expect(result.find((row) => row.name === 'interruptions').status).toBe('FAIL')
    expect(result.find((row) => row.name === 'byte equality').status).toBe('FAIL')
  })
  it('uses strict timing boundaries', () => {
    const result = budgets({
      verifiedFiles: 1000,
      mismatches: [],
      ownDownloads: 0,
      notices: 0,
      restartRequestMs: 5000,
      restartIdleMs: 60000,
      resumeUploadMs: 30000,
      pauseLatencyMs: 2000,
      pauseNewRequests: 0,
      interruptions: Array.from({ length: 6 }, (_, i) => ({ kind: String(i), triggered: true })),
    })
    expect(
      result
        .filter(
          (row) =>
            row.name.includes('restart') ||
            row.name === 'resume upload' ||
            row.name === 'pause latency'
        )
        .every((row) => row.status === 'FAIL')
    ).toBe(true)
  })
  it('observes owned content outside the plugin and omits secrets from its trace', async () => {
    const digest = 'a'.repeat(64)
    const upstream = createServer(async (req, res) => {
      for await (const _ of req) {
        /* drain upload metadata */
      }
      res.setHeader('content-type', 'application/json')
      if (req.url === '/v2/commit') {
        res.setHeader('content-encoding', 'gzip')
        res.end(gzipSync(JSON.stringify({ results: [{ version_id: 'v1', sha: digest }] })))
      } else res.end('content')
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP fixture')
    const proxy = new WireProxy(`http://127.0.0.1:${address.port}`, 'sample-device')
    const url = await proxy.start()
    try {
      // A legitimate remote download must not become an own-download retroactively.
      await (await globalThis.fetch(url + '/v2/files/f1/content?version_id=v1')).text()
      await (
        await globalThis.fetch(url + '/v2/commit', {
          method: 'POST',
          headers: { authorization: 'Bearer sample-secret' },
          body: JSON.stringify({ ops: [{ sha: digest }] }),
        })
      ).text()
      expect(proxy.ownDownloads()).toBe(0)
      await (
        await globalThis.fetch(url + '/v2/files/f1/content?version_id=v1&key=sample-secret')
      ).text()
      expect(proxy.ownDownloads()).toBe(1)
      expect(proxy.unresolvedDownloads()).toBe(0)
      expect(JSON.stringify(proxy.events)).not.toContain('sample-secret')
      await (await globalThis.fetch(url + '/v2/files/f1/content?version_id=unknown')).text()
      expect(proxy.unresolvedDownloads()).toBe(1)
      proxy.drop()
      await expect(globalThis.fetch(url + '/v2/manifest')).rejects.toThrow()
    } finally {
      await proxy.close()
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })
  it('interrupts a large file inside a bounded multipart chunk', async () => {
    const upstream = createServer(async (req, res) => {
      for await (const _ of req) {
        /* drain synthetic bytes */
      }
      res.end('ok')
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP fixture')
    const proxy = new WireProxy(`http://127.0.0.1:${address.port}`, 'sample-device')
    const url = await proxy.start()
    proxy.breakpoint = 'large-upload'
    proxy.breakpointSha = 'b'.repeat(64)
    let timer
    const hit = new Promise((resolve) => {
      proxy.on('wire', (event) => {
        if (event.event === 'trigger') resolve(true)
      })
      timer = setTimeout(() => resolve(false), 1000)
    })
    const transfer = globalThis
      .fetch(`${url}/v2/uploads/${proxy.breakpointSha}/sample-upload/0`, {
        method: 'PUT',
        body: Buffer.alloc(256 * 1024),
      })
      .then((r) => r.text())
      .catch(() => null)
    try {
      expect(await hit).toBe(true)
    } finally {
      clearTimeout(timer)
      await proxy.close()
      await transfer
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })
})
