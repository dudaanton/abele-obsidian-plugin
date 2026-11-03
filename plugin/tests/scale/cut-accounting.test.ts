// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'
import { longTaskScope, profileSummary } from './diagnostics.mjs'
import { longTaskVerdict } from './oracles.mjs'
const { isHostPersistence } = createRequire(import.meta.url)('./writes.cjs')

const wrappers = `Error
 at fi.wrapped (/sample/scale-observer/writes.cjs:97:21)
 at mutate (plugin:abele:100:46)
 at plugin:abele:101:150
 at ChangeTracker.around (plugin:abele:102:14)
 at fi.<anonymous> (plugin:abele:103:51)
 at fi.write (plugin:abele:104:42)`
const host =
  '\n at by.saveLayout (app://obsidian.md/app.js:10:20)\n at c (app://obsidian.md/app.js:11:30)'
it.each(['workspace', 'app', 'appearance'])(
  'recognizes host %s persistence through unnamed and minified adapter wrappers',
  (name) => {
    expect(isHostPersistence({ path: `.obsidian/${name}.json`, stack: wrappers + host })).toBe(true)
  }
)
it.each([
  wrappers + '\n at uploadState (plugin:abele:105:1)' + host,
  wrappers + host + '\n at pluginAction (plugin:abele:106:1)',
  'Error\n at pluginAction (plugin:abele:106:1)' + host,
])('keeps a plugin-originated config write classified as plugin', (stack) => {
  expect(isHostPersistence({ path: '.obsidian/workspace.json', stack })).toBe(false)
})

it('does not open a reload sync scope before the new profiler acknowledges', async () => {
  const evidence = [
    { event: 'renderer-start', device: '0', at: 0 },
    { event: 'cpu-profile-ready', device: '0', at: 10 },
    { event: 'plugin-load-mark', name: 'abele:onload-end', device: '0', at: 20 },
    { event: 'renderer-navigation', device: '0', at: 100 },
    { event: 'plugin-load-mark', name: 'abele:onload-end', device: '0', at: 120 },
  ]
  const task = { event: 'long-task', device: '0', startedAt: 130, durationMs: 60 }
  expect(longTaskScope(task, evidence)).toBe('load')
  evidence.push({ event: 'cpu-profile-ready', device: '0', at: 140 })
  expect(longTaskScope({ ...task, startedAt: 150 }, evidence)).toBe('sync')
  const [missing] = await profileSummary([{ ...task, startedAt: 150 }], evidence, async () => null)
  expect(missing.owner).toBe('unattributed')
  expect(longTaskVerdict(missing).status).toBe('FAIL')
})

it('restarts and acknowledges CPU capture for a navigated webContents before reusing it', async () => {
  const source = await readFile(new URL('./diagnostics.cjs', import.meta.url), 'utf8')
  const wc: any = new EventEmitter(),
    events: any[] = [],
    calls: string[] = []
  let attached = false,
    sequence = 0
  wc.debugger = {
    isAttached: () => attached,
    attach: () => {
      attached = true
    },
    detach: () => {
      attached = false
    },
    sendCommand: async (name: string) => {
      calls.push(name)
      return name === 'Performance.getMetrics'
        ? { metrics: [{ name: 'Timestamp', value: 1 }] }
        : { profile: { nodes: [] } }
    },
  }
  const module = { exports: {} }
  runInNewContext(source, {
    module,
    exports: module.exports,
    Date,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout,
    require(name: string) {
      if (name === 'electron')
        return { webContents: { fromId: () => wc }, ipcMain: new EventEmitter() }
      if (name === 'node:crypto') return { randomUUID: () => String(++sequence) }
      if (name === './evidence-writer.cjs')
        return {
          writerFor: () => ({
            enqueue(line: string) {
              events.push(JSON.parse(line))
            },
          }),
        }
      if (name === 'node:fs') return { mkdirSync() {}, writeFileSync() {} }
      throw new Error('Unexpected fixture dependency')
    },
  })
  const api: any = module.exports
  const config = JSON.stringify({
    evidence: 'sample',
    device: '0',
    continuousCpu: true,
    javascriptHashTracepoints: [],
    preciseHashCoverage: false,
    profileDirectory: '/sample',
  })
  const first = await api.watch(7, config)
  await api.beginReindexCoverage(first, 'sample-rebuild')
  expect(calls.filter((name) => name === 'Profiler.start')).toHaveLength(2)
  expect(events.filter((row) => row.event === 'cpu-profile')).toHaveLength(1)
  wc.emit('did-start-navigation', {}, 'app://sample', false, true)
  const second = await api.watch(7, config)
  try {
    expect(second).not.toBe(first)
    expect(calls.filter((name) => name === 'Profiler.start')).toHaveLength(3)
    expect(api.profileReady(second)).toBe(true)
    expect(events.filter((row) => row.event === 'renderer-navigation')).toHaveLength(1)
  } finally {
    await api.unwatch(second)
  }
})
