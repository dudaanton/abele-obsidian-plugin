// @vitest-environment node
import { expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { readFile } from 'node:fs/promises'
import { settleRestartDevices, controlTiming } from '../scale/restart.mjs'

it('starts both restart settle checks before either finishes and keeps each idle time', async () => {
  const entered: string[] = []
  const finish: Record<string, () => void> = {}
  const timings: Array<{ step: string; idle: boolean; endedAt: number }> = []
  const work = settleRestartDevices(
    ['primary', 'peer'],
    (device, step) =>
      new Promise<boolean>((resolve) => {
        entered.push(device)
        finish[device] = () => {
          timings.push({ step, idle: true, endedAt: device === 'peer' ? 1200 : 5000 })
          resolve(true)
        }
      }),
    timings
  )
  expect(entered).toEqual(['primary', 'peer'])
  finish.peer()
  finish.primary()
  expect(await work).toEqual([5000, 1200])
})

it('derives control request and idle from each device receipt', () => {
  expect(
    controlTiming(
      1000,
      [
        { event: 'start', at: 1700 },
        { event: 'start', at: 1800 },
      ],
      {
        pluginLoadAt: 1200,
        firstIdleAt: 2100,
      }
    )
  ).toMatchObject({
    pluginLoadToFirstRequestMs: 500,
    pluginLoadToIdleMs: 900,
    launchToFirstRequestMs: 700,
    launchToIdleMs: 1100,
  })
})

it('runs the control observer without loading or installing any instrument family', async () => {
  const source = await readFile(new URL('../scale/observer.cjs', import.meta.url), 'utf8')
  const loaded: string[] = []
  const writes: Record<string, any> = {}
  const config = { mode: 'control', controlReceipt: '/sample/control.json' }
  let poll: (() => void) | undefined
  let mark: ((items: any) => void) | undefined
  const host = {
    live: new Map([['sample', { engine: { status: { state: 'syncing', lastSyncAt: null } } }]]),
    ui: { rows: { value: [{ status: 'syncing' }] } },
  }
  const module = { exports: null as any }
  runInNewContext(source, {
    module,
    globalThis: { process: { pid: 7 } },
    Date: class {
      static now() {
        return 2000
      }
    },
    performance: { timeOrigin: 1000 },
    PerformanceObserver: class {
      constructor(callback: any) {
        mark = callback
      }
      observe() {}
      disconnect() {}
    },
    setInterval: (callback: () => void) => {
      poll = callback
      return 1
    },
    clearInterval() {},
    require: (name: string) => {
      loaded.push(name)
      if (name === 'obsidian')
        return {
          Plugin: class {
            app = {
              vault: { adapter: { getBasePath: () => '/sample' } },
              plugins: { plugins: { abele: { tokenEngines: host } } },
            }
            register() {}
          },
          Notice: class {},
        }
      if (name === 'fs')
        return {
          readFileSync: () => JSON.stringify(config),
          writeFileSync: (path: string, value: string) => {
            writes[path] = JSON.parse(value)
          },
        }
      if (name === 'path') return { join: (...parts: string[]) => parts.join('/') }
      throw new Error(`Unexpected instrument module: ${name}`)
    },
  })
  const observer = new module.exports()
  await observer.onload()
  mark?.({ getEntries: () => [{ name: 'abele:onload-start', startTime: 250 }] })
  expect(writes[config.controlReceipt].pluginLoadAt).toBe(1250)
  poll?.()
  expect(writes[config.controlReceipt].firstIdleAt).toBeUndefined()
  host.ui.rows.value[0].status = 'idle'
  host.live.get('sample')!.engine.status = { state: 'idle', lastSyncAt: 'now' }
  poll?.()
  expect(writes[config.controlReceipt].firstIdleAt).toBe(2000)
  expect(loaded).toEqual(['obsidian', 'fs', 'path'])
})
