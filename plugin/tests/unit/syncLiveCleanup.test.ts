// @vitest-environment node
import { expect, it, vi, afterEach } from 'vitest'
import { TokenSyncLive } from '../e2e/helpers/tokenSyncLive'
import { spawnSyncServer } from '../e2e/helpers/syncServer'
import { exposeToPhone, phoneReverseStatus, waitForPhoneRoute } from '../e2e/helpers/phone'
import { onPhone } from '../e2e/helpers/target'
import { SyncDriver } from '../e2e/helpers/syncDriver'
import { cancelSyncJobs, assertSyncJob, finishSyncJob } from '../e2e/helpers/syncJobs'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import * as routeProbe from '../e2e/helpers/phoneRouteProbe'
import { startupScanProgress } from '../e2e/helpers/startupWait'
vi.mock('../e2e/helpers/syncVault', () => ({ waitFor: vi.fn(async () => {}) }))
vi.mock('../e2e/helpers/syncServer', () => ({
  siblingMissing: vi.fn(),
  fixtureFetch: vi.fn(),
  spawnSyncServer: vi.fn(),
}))
vi.mock('../e2e/helpers/obsidianCli', () => ({ vaultCli: vi.fn() }))
vi.mock('../e2e/helpers/phone', async (original) => ({
  ...(await original<typeof import('../e2e/helpers/phone')>()),
  PHONE_VAULT: 'phone',
  exposeToPhone: vi.fn(),
  phoneReverseStatus: vi.fn(() => 'listed'),
  waitForPhoneRoute: vi.fn(async (probe: () => Promise<unknown>) => {
    await probe()
  }),
}))
vi.mock('../e2e/helpers/target', () => ({ onPhone: vi.fn(() => false) }))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(onPhone).mockReturnValue(false)
})

it.each(['activation', 'ownership', 'first sync'])(
  'retires a saved connection before a failed %s returns to window restoration',
  async (phase) => {
    vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
    const live = new TokenSyncLive(false)
    const token = Buffer.from(
      JSON.stringify({
        v: 1,
        address: 'https://sync.example',
        key: 'a'.repeat(43),
        scope: { kind: 'folder', id: 'sample-root', path: '/' },
      })
    ).toString('base64')
    const kill = vi.fn(async () => {})
    live.servers.push({ rootToken: token, kill } as never)
    live.ids.set(live.primary, [])
    Reflect.get(live, 'saved').set(live.primary, { ignore: null, file: null })
    let saved = false
    vi.spyOn(live.primary, 'rows').mockImplementation(() =>
      saved ? ([{ id: 'sample' }] as never) : []
    )
    vi.spyOn(live.primary, 'connect').mockImplementation(async () => {
      saved = true
      if (phase === 'activation') throw new Error('sample activation failed')
      return 'sample'
    })
    vi.spyOn(live.primary, 'captureTokenOwnership').mockImplementation(() => {
      if (phase === 'ownership') throw new Error('sample ownership failed')
    })
    vi.spyOn(live.primary, 'syncNow').mockRejectedValue(new Error('sample first sync failed'))
    const reset = vi.spyOn(live.primary, 'resetTokenState').mockImplementation(async () => {
      saved = false
    })
    vi.spyOn(live.primary, 'assertTokenStateReset').mockImplementation(() => {
      expect(saved).toBe(false)
    })
    vi.spyOn(live.primary, 'run').mockReturnValue(true)
    vi.spyOn(live.primary, 'removeTree').mockResolvedValue()
    await expect(live.connect()).rejects.toThrow('sample ' + phase + ' failed')
    expect(reset).toHaveBeenCalledOnce()
    expect(kill).not.toHaveBeenCalled()
    expect(live.primary.ended).toBe(false)
    expect(saved).toBe(false)
    expect(live.ids.get(live.primary)).toEqual(['sample'])
    await live.close()
    expect(kill).toHaveBeenCalledOnce()
  }
)

it('waits for both peers to consume a directory commit queued after the child deletion', async () => {
  const live = Object.create(TokenSyncLive.prototype) as TokenSyncLive
  let head = 0,
    primarySeen = -1,
    peerCalls = 0
  Reflect.set(live, 'primary', {
    syncNow: async () => {
      primarySeen = head
    },
  })
  Reflect.set(live, 'peer', {
    syncNow: async () => {
      if (++peerCalls <= 2) head++
    },
  })
  // The engine client exposes head_seq; cursor belongs to the raw wire response.
  vi.spyOn(live, 'client').mockReturnValue({ manifest: async () => ({ head_seq: head }) } as never)
  await live.cycle()
  expect(primarySeen).toBe(head)
  expect(peerCalls).toBe(3)
})
it('waits through a retried read conflict instead of rejecting a successful connect', async () => {
  const device = new SyncDriver({} as never)
  const rows: { id: string; status: string }[] = []
  let activity: { error?: string } = { error: 'Sample file changed while reading' }
  const engine = {
    state: 'syncing',
    lastSyncAt: null as number | null,
    lastError: 'Sample read conflict' as string | null,
  }
  const svc = { rows: { value: rows }, connectionActivity: () => activity }
  const app = {
    plugins: {
      plugins: {
        abele: {
          tokenEngines: { ui: svc, live: new Map([['sample', { engine: { status: engine } }]]) },
        },
      },
    },
  }
  let first: { ready: boolean; error?: string } | undefined
  vi.spyOn(device, 'long').mockImplementation(async (_what, body) => {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
    let connected = false
    return new AsyncFunction(
      'svc',
      'app',
      'openSyncTab',
      'press',
      'poll',
      'modal',
      'typeInto',
      'waitForStartup',
      'startupScanProgress',
      'closeSettings',
      body
    )(
      svc,
      app,
      async () => ({}),
      async (_root: unknown, label: string) => {
        if (label === 'Connect') {
          connected = true
          rows.push({ id: 'sample', status: 'syncing' })
        }
      },
      async () => {},
      () => (connected ? null : { querySelector: () => ({}) }),
      () => {},
      async (read: () => { ready: boolean; error?: string }) => {
        first = read()
        expect(first).toMatchObject({ ready: false, error: undefined })
        rows[0].status = 'error'
        engine.state = 'error'
        expect(read().error).toBe('Sample file changed while reading')
        activity = {}
        engine.lastError = null
        expect(read().error).toBe('Connection entered error before its first successful sync')
        activity = {}
        rows[0].status = 'idle'
        engine.state = 'idle'
        engine.lastSyncAt = 1000
        engine.lastError = null
        expect(read()).toMatchObject({ ready: true, error: undefined })
      },
      startupScanProgress,
      async () => {}
    )
  })
  const result = await device.connect('sample-token').catch((error: unknown) => error)
  expect(first).toMatchObject({ ready: false, error: undefined })
  expect(result).toBe('sample')
})

it('revokes old polling jobs and refuses late completion without resurrecting them', () => {
  const jobs = { __abeleSyncJobold: null, __abeleSyncJobcurrent: null, unrelated: 'keep' }
  cancelSyncJobs(jobs, '__abeleSyncJobcurrent')
  expect(() => assertSyncJob(jobs, '__abeleSyncJobold')).toThrow('cancelled')
  finishSyncJob(jobs, '__abeleSyncJobold', { ok: true })
  expect(jobs).toEqual({ __abeleSyncJobcurrent: null, unrelated: 'keep' })
})

it('lets guarded reset cancel the host before waiting on orphan UI jobs', async () => {
  const device = new SyncDriver({} as never)
  const fakeWindow: Record<string, unknown> = { __abeleSyncJobold: null }
  let reset = false
  const doc = { querySelectorAll: () => [] }
  fakeWindow.__abeleTest = {
    resetSyncTokenState: async () => {
      reset = true
    },
  }
  vi.spyOn(device, 'long').mockImplementation(async (_what, body) => {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
    return new AsyncFunction('window', 'document', 'settingsDoc', 'app', 'jobKey', 'poll', body)(
      fakeWindow,
      doc,
      () => doc,
      { vault: { getName: () => 'sample-pool' } },
      'current',
      async (fn: () => boolean) => {
        if (!fn()) throw new Error('old UI job prevents host cancellation')
      }
    )
  })
  await device.resetTokenState()
  expect(reset).toBe(true)
  expect(fakeWindow).not.toHaveProperty('__abeleSyncJobold')
})

it('retains every phone reverse through the case and checks WebSockets on the device', async () => {
  vi.mocked(onPhone).mockReturnValue(true)
  mkdirSync(resolve('../.scratch'), { recursive: true })
  const live = new TokenSyncLive(false)
  ;(live as unknown as { work: string }).work = mkdtempSync(
    join(resolve('../.scratch'), 'reverse-case-')
  )
  const stops = [vi.fn(), vi.fn()]
  vi.mocked(exposeToPhone).mockResolvedValueOnce(stops[0]).mockResolvedValueOnce(stops[1])
  const kills = [vi.fn(), vi.fn()]
  const token = Buffer.from(
    JSON.stringify({
      v: 1,
      address: 'http://127.0.0.1:12345',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'root', path: '/' },
    })
  ).toString('base64')
  for (let index = 0; index < 2; index++)
    vi.mocked(spawnSyncServer).mockResolvedValueOnce({
      url: `http://127.0.0.1:${12345 + index}`,
      rootToken: token,
      kill: kills[index],
    } as unknown as Awaited<ReturnType<typeof spawnSyncServer>>)
  const probe = vi.spyOn(live.primary, 'long').mockResolvedValue({ ok: true })
  try {
    await live.addServer()
    await live.addServer()
    expect(vi.mocked(exposeToPhone).mock.calls.slice(-2)).toEqual([[12345], [12346]])
    expect(probe).toHaveBeenCalledTimes(2)
    for (const [label, body, confidential] of probe.mock.calls) {
      expect(label).toBe('phone fixture WebSocket route')
      expect(body).toContain('/v2/events')
      expect(body).toContain('new WebSocket')
      expect(confidential).toBe(true)
    }
    for (const stop of stops) expect(stop).not.toHaveBeenCalled()
    probe.mockResolvedValueOnce({
      ok: false,
      stage: 'upgrade',
      cause: 'close',
      code: 1006,
      clean: false,
    })
    vi.mocked(spawnSyncServer).mockResolvedValueOnce({
      url: 'http://127.0.0.1:12347',
      rootToken: token,
      kill: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof spawnSyncServer>>)
    vi.mocked(exposeToPhone).mockResolvedValueOnce(vi.fn())
    await expect(live.addServer()).rejects.toThrow(
      'port=12347 reverse=listed stage=upgrade cause=close code=1006 clean=false'
    )
    expect(phoneReverseStatus).toHaveBeenCalledWith(12347)
    probe.mockRejectedValueOnce(new Error('Bearer sample-private-key; observed private snapshot'))
    vi.mocked(spawnSyncServer).mockResolvedValueOnce({
      url: 'http://127.0.0.1:12348',
      rootToken: token,
      kill: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof spawnSyncServer>>)
    vi.mocked(exposeToPhone).mockResolvedValueOnce(vi.fn())
    await expect(live.addServer()).rejects.toThrow(
      'port=12348 reverse=listed stage=unknown cause=private-job'
    )
  } finally {
    await live.close()
  }
  for (const stop of stops) expect(stop).toHaveBeenCalledOnce()
  for (const kill of kills) expect(kill).toHaveBeenCalledOnce()
})

it('shares one teardown when a timeout hook and its late body both close the same fixture', async () => {
  vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
  mkdirSync(resolve('../.scratch'), { recursive: true })
  const live = new TokenSyncLive(false)
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const reset = vi.spyOn(live.primary, 'resetTokenState').mockImplementation(async () => {
    await waiting
  })
  vi.spyOn(live.primary, 'removeTree').mockResolvedValue(undefined)
  vi.spyOn(live.primary, 'run').mockReturnValue(true)
  const saved = (
    live as unknown as { saved: Map<typeof live.primary, { ignore: null; file: null }> }
  ).saved
  saved.set(live.primary, { ignore: null, file: null })
  const first = live.close(),
    second = live.close()
  release()
  await Promise.all([first, second])
  expect(reset).toHaveBeenCalledOnce()
})

it('attempts both pool resets and restores each pool even when the first reset fails', async () => {
  vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
  vi.stubEnv('ABELE_SYNC_PEER_VAULT', 'peer-pool')
  const live = new TokenSyncLive()
  const devices = [live.primary, live.peer!]
  const resets = devices.map((device, index) =>
    vi.spyOn(device, 'resetTokenState').mockImplementation(async () => {
      if (index === 1) throw new Error('blocked')
    })
  )
  const forced = devices.map((device) =>
    vi.spyOn(device, 'forceResetTokenState').mockResolvedValue()
  )
  const removals = devices.map((device) =>
    vi.spyOn(device, 'removeTree').mockResolvedValue(undefined)
  )
  const restorations = devices.map((device) => vi.spyOn(device, 'run').mockReturnValue(true))
  const saved = (
    live as unknown as {
      saved: Map<typeof live.primary, { ignore: string | null; file: string | null }>
    }
  ).saved
  for (const device of devices) saved.set(device, { ignore: 'existing ignore', file: null })
  await live.close()
  expect(forced[1]).toHaveBeenCalledOnce()
  expect(forced[0]).not.toHaveBeenCalled()
  for (let index = 0; index < devices.length; index++) {
    expect(resets[index]).toHaveBeenCalledOnce()
    expect(removals[index]).toHaveBeenCalledWith([live.root], true)
    expect(restorations[index].mock.calls.some(([body]) => body.includes('existing ignore'))).toBe(
      true
    )
    expect(
      restorations[index].mock.calls.some(([body]) => body.includes('__abeleSyncVisibility'))
    ).toBe(true)
  }
  await live.close()
  for (const reset of resets) expect(reset).toHaveBeenCalledOnce()
})

it('names discovered connections and pending paths without resetting pre-existing state', async () => {
  vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
  mkdirSync(resolve('../.scratch'), { recursive: true })
  const live = new TokenSyncLive(false)
  vi.spyOn(live.primary, 'rows').mockReturnValue([
    { id: 'existing-id', status: 'offline', address: 'https://sync.example', paused: false },
  ])
  vi.spyOn(live.primary, 'candidates').mockReturnValue([{ path: 'Scripts/pending.js' }] as never)
  vi.spyOn(live.primary, 'questions').mockReturnValue([])
  const reset = vi.spyOn(live.primary, 'resetTokenState')
  await expect(live.start()).rejects.toThrow('existing-id (offline)')
  await expect(live.start()).rejects.toThrow('Scripts/pending.js')
  expect(reset).not.toHaveBeenCalled()
})

it('reports both cleanup failures while still restoring the lease', async () => {
  vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
  mkdirSync(resolve('../.scratch'), { recursive: true })
  const live = new TokenSyncLive(false)
  vi.spyOn(live.primary, 'resetTokenState').mockRejectedValue(new Error('polite blocked'))
  vi.spyOn(live.primary, 'forceResetTokenState').mockRejectedValue(
    new Error('guarded recovery required')
  )
  const restore = vi.spyOn(live.primary, 'run').mockReturnValue(true)
  const remove = vi.spyOn(live.primary, 'removeTree').mockResolvedValue(undefined)
  const saved = (
    live as unknown as {
      saved: Map<typeof live.primary, { ignore: string | null; file: string | null }>
    }
  ).saved
  saved.set(live.primary, { ignore: 'original ignore', file: null })
  await expect(live.close()).rejects.toThrow('polite blocked; guarded recovery required')
  // An unretired connection must keep its source bytes; lease restoration still runs.
  expect(remove).not.toHaveBeenCalled()
  expect(restore.mock.calls.some(([body]) => body.includes('original ignore'))).toBe(true)
})

it('uses the full reset fallback when a successful reset leaves persisted records', async () => {
  vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
  const live = new TokenSyncLive(false)
  const saved = (
    live as unknown as { saved: Map<typeof live.primary, { ignore: null; file: null }> }
  ).saved
  saved.set(live.primary, { ignore: null, file: null })
  let retained = true
  vi.spyOn(live.primary, 'resetTokenState').mockResolvedValue()
  const fallback = vi.spyOn(live.primary, 'forceResetTokenState').mockImplementation(async () => {
    retained = false
  })
  const run = vi.spyOn(live.primary, 'run').mockImplementation((body) => {
    if (body.includes("app.loadLocalStorage('abele-sync-connections-v2')") && retained)
      throw new Error('Token pool reset left connection records')
    return true as never
  })
  vi.spyOn(live.primary, 'removeTree').mockResolvedValue(undefined)
  await live.close()
  expect(fallback).toHaveBeenCalledOnce()
  expect(
    run.mock.calls.filter(([body]) =>
      body.includes("app.loadLocalStorage('abele-sync-connections-v2')")
    )
  ).toHaveLength(2)
})

it('reports retained records after the fallback while still restoring the lease', async () => {
  vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
  const live = new TokenSyncLive(false)
  const saved = (
    live as unknown as { saved: Map<typeof live.primary, { ignore: string; file: null }> }
  ).saved
  saved.set(live.primary, { ignore: 'sample original ignore', file: null })
  vi.spyOn(live.primary, 'resetTokenState').mockResolvedValue()
  vi.spyOn(live.primary, 'forceResetTokenState').mockResolvedValue()
  const run = vi.spyOn(live.primary, 'run').mockImplementation((body) => {
    if (body.includes("app.loadLocalStorage('abele-sync-connections-v2')"))
      throw new Error('Token pool reset left connection records')
    return true as never
  })
  const remove = vi.spyOn(live.primary, 'removeTree').mockResolvedValue(undefined)
  await expect(live.close()).rejects.toThrow('Token pool reset left connection records')
  // An unretired connection must keep its source bytes; lease restoration still runs.
  expect(remove).not.toHaveBeenCalled()
  expect(run.mock.calls.some(([body]) => body.includes('sample original ignore'))).toBe(true)
})

it('keeps fixture bytes when neither reset can prove its connection retired', async () => {
  vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
  const live = new TokenSyncLive(false)
  ;(live as unknown as { saved: Map<typeof live.primary, { ignore: null; file: null }> }).saved.set(
    live.primary,
    { ignore: null, file: null }
  )
  vi.spyOn(live.primary, 'resetTokenState').mockRejectedValue(new Error('sample drain failed'))
  vi.spyOn(live.primary, 'forceResetTokenState').mockRejectedValue(
    new Error('sample recovery pending')
  )
  vi.spyOn(live.primary, 'run').mockReturnValue(true)
  const remove = vi.spyOn(live.primary, 'removeTree').mockResolvedValue()
  await expect(live.close()).rejects.toThrow('sample recovery pending')
  expect(remove).not.toHaveBeenCalled()
})

it('records a phone case end once even when shared cleanup rejects', async () => {
  vi.mocked(onPhone).mockReturnValue(true)
  const live = Object.create(TokenSyncLive.prototype) as TokenSyncLive
  const phaseMemory = vi.fn()
  Reflect.set(live, 'primary', { phaseMemory })
  Reflect.set(
    live,
    'closeOwned',
    vi.fn(async () => {
      throw new Error('sample cleanup failure')
    })
  )
  const first = live.close()
  const second = live.close()
  expect(first).toBe(second)
  await expect(first).rejects.toThrow('sample cleanup failure')
  expect(phaseMemory).toHaveBeenCalledExactlyOnceWith('phone case', 'after', true)
})

it('reopens only its fixture reverse after a pre-authentication close and releases both owners', async () => {
  const localProbe = vi.spyOn(routeProbe, 'phoneRouteProbe').mockResolvedValue({ ok: true })
  vi.mocked(onPhone).mockReturnValue(true)
  vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
  mkdirSync(resolve('../.scratch'), { recursive: true })
  const live = new TokenSyncLive(false)
  Reflect.set(live, 'work', mkdtempSync(join(resolve('../.scratch'), 'route-case-')))
  const oldStop = vi.fn(async () => {})
  const newStop = vi.fn(async () => {})
  vi.mocked(exposeToPhone)
    .mockResolvedValueOnce(oldStop)
    .mockImplementationOnce(async () => {
      expect(oldStop).toHaveBeenCalledOnce()
      return newStop
    })
  const token = Buffer.from(
    JSON.stringify({
      v: 1,
      address: 'http://127.0.0.1:12345',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'root', path: '/' },
    })
  ).toString('base64')
  vi.mocked(spawnSyncServer).mockResolvedValueOnce({
    url: 'http://127.0.0.1:12345',
    rootToken: token,
    kill: vi.fn(),
  } as unknown as Awaited<ReturnType<typeof spawnSyncServer>>)
  const actual =
    await vi.importActual<typeof import('../e2e/helpers/phone')>('../e2e/helpers/phone')
  vi.mocked(waitForPhoneRoute).mockImplementationOnce(actual.waitForPhoneRoute)
  vi.spyOn(live.primary, 'long')
    .mockResolvedValueOnce({ ok: false, stage: 'upgrade', cause: 'close', code: 1006 })
    .mockResolvedValue({ ok: true })
  try {
    await live.addServer()
    const attempts = vi.mocked(exposeToPhone).mock.calls.slice(-2)
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toEqual([12345])
    expect(attempts[1][0]).toBe(12345)
    expect(attempts[1][1]).toBeGreaterThan(0)
    expect(attempts[1][1]).toBeLessThanOrEqual(30000)
    expect(newStop).not.toHaveBeenCalled()
  } finally {
    try {
      await live.close()
    } finally {
      localProbe.mockRestore()
    }
  }
  expect(newStop).toHaveBeenCalledOnce()
})
