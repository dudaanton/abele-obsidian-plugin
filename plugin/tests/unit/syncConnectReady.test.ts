// @vitest-environment node
import { expect, it } from 'vitest'
import { SyncDriver } from '../e2e/helpers/syncDriver'
it('connect waits for Ready with a successful first sync instead of private runtime bookkeeping', async () => {
  const driver = new SyncDriver(() => {
    throw new Error('No live vault')
  })
  let code = ''
  driver.long = async (_label, body) => {
    code = body
    return 'sample' as never
  }
  await driver.connect('sample-token')
  const row = { id: 'sample', status: 'idle' }
  const svc = {
    rows: { value: [] as (typeof row)[] },
    runtimes: new Map(),
    activity: { value: { sample: { startupTimings: [{ outcome: 'complete' }] } } },
  }
  const host = {
    ui: svc,
    live: new Map([
      [
        'sample',
        {
          engine: {
            status: { state: 'idle', lastSyncAt: '2026-10-10T19:55:33.036Z', lastError: null },
          },
        },
      ],
    ]),
  }
  let observed: { ready: boolean } | undefined
  await new Function(
    'svc',
    'app',
    'openSyncTab',
    'press',
    'poll',
    'modal',
    'typeInto',
    'waitForStartup',
    'closeSettings',
    `return (async()=>{${code}})()`
  )(
    svc,
    { plugins: { plugins: { abele: { tokenEngines: host } } } },
    async () => ({}),
    async () => {
      svc.rows.value = [row]
    },
    async () => {},
    () => ({ querySelector: () => ({}) }),
    () => {},
    async (read: () => { ready: boolean }) => {
      observed = read()
      if (!observed.ready) throw new Error('Ready product rejected')
    },
    async () => {}
  )
  expect(observed?.ready).toBe(true)
})
