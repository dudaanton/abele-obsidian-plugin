// @vitest-environment node
import { expect, it, vi, afterEach } from 'vitest'
import { TokenSyncLive } from '../e2e/helpers/tokenSyncLive'
import { spawnSyncServer } from '../e2e/helpers/syncServer'
import { exposeToPhone, phoneReverseStatus } from '../e2e/helpers/phone'
import { onPhone } from '../e2e/helpers/target'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
vi.mock('../e2e/helpers/syncVault', () => ({ waitFor: vi.fn() }))
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
  waitForPhoneRoute: async (probe: () => Promise<unknown>) => {
    await probe()
  },
}))
vi.mock('../e2e/helpers/target', () => ({ onPhone: vi.fn(() => false) }))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(onPhone).mockReturnValue(false)
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
  expect(remove).toHaveBeenCalledWith([live.root], true)
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
  expect(remove).toHaveBeenCalledWith([live.root], true)
  expect(run.mock.calls.some(([body]) => body.includes('sample original ignore'))).toBe(true)
})
