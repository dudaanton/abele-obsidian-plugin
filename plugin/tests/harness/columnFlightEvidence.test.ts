import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  enablePhoneColumnFlight,
  noteColumnPhoneFailure,
  saveColumnFlightAfterRecovery,
} from '../e2e/helpers/columnFlightEvidence'

const phone = vi.hoisted(() => ({ eval: vi.fn(), driver: vi.fn() }))
const disk = vi.hoisted(() => ({ fail: false }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  const write = (...args: Parameters<typeof fs.writeFileSync>) => {
    if (disk.fail) throw new Error('sample disk failure')
    return fs.writeFileSync(...args)
  }
  return { ...fs, default: { ...fs, writeFileSync: write }, writeFileSync: write }
})
vi.mock('../e2e/helpers/phone', () => ({ phoneEval: phone.eval, driver: phone.driver }))
const root = join(process.cwd(), 'node_modules/sample-column-evidence')
const dir = join(root, 'columns-flight')
const buffer = { version: 1, epoch: '10', entries: [{ counter: 42, site: 'doc.redraw.in' }] }
beforeEach(() => {
  disk.fail = false
  mkdirSync(root, { recursive: true })
  vi.stubEnv('ABELE_E2E_SHOTS', root)
  phone.eval.mockReset().mockReturnValue(
    '=> ' +
      JSON.stringify({
        timeOrigin: 20,
        text: JSON.stringify(buffer),
        originalChars: 100,
        truncated: false,
      })
  )
  phone.driver.mockReset().mockReturnValue('{"app":"running"}')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  disk.fail = false
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

it('keeps the first transport failure and saves its buffer after recovery before arming a retry', () => {
  noteColumnPhoneFailure('tests/e2e/columns.e2e.test.ts', 'first case', [
    'the phone gave no answer in 8000 ms',
  ])
  noteColumnPhoneFailure('tests/e2e/columns.e2e.test.ts', 'later case', [
    'phone driver transport: missing reply',
  ])
  expect(phone.driver).toHaveBeenCalledOnce()
  phone.eval.mockImplementation((code: string) => {
    if (code.includes('localStorage.setItem')) {
      expect(readdirSync(dir).some((file) => file.startsWith('flight-'))).toBe(true)
      return '=> true'
    }
    return (
      '=> ' +
      JSON.stringify({
        timeOrigin: 20,
        text: JSON.stringify(buffer),
        originalChars: 100,
        truncated: false,
      })
    )
  })
  enablePhoneColumnFlight()
  const artifact = readdirSync(dir).find((file) => file.startsWith('flight-'))!
  const saved = JSON.parse(readFileSync(join(dir, artifact), 'utf8'))
  expect(saved.failure.test).toBe('first case')
  expect(saved.buffer).toEqual(buffer)
  expect(saved.failure.liveness).toEqual({ status: 'answered', appRunning: true })
  expect(existsSync(join(dir, 'pending.json'))).toBe(false)
})

it('does not arm a new recorder or remove pending evidence when artifact writing fails', () => {
  noteColumnPhoneFailure('columnSafety.e2e.test.ts', 'case', ['the phone gave no answer'])
  const pending = readFileSync(join(dir, 'pending.json'), 'utf8')
  disk.fail = true
  expect(enablePhoneColumnFlight()).toBe(false)
  expect(phone.eval.mock.calls.some(([code]) => code.includes('localStorage.setItem'))).toBe(false)
  expect(readFileSync(join(dir, 'pending.json'), 'utf8')).toBe(pending)
  expect(readdirSync(dir).filter((file) => file.startsWith('flight-'))).toHaveLength(0)
  disk.fail = false
  expect(enablePhoneColumnFlight()).toBe(true)
  expect(existsSync(join(dir, 'pending.json'))).toBe(false)
})

it('archives a stale page buffer even when a killed worker left no failure marker', () => {
  expect(saveColumnFlightAfterRecovery()).toBe(true)
  const files = readdirSync(dir).filter((file) => file.startsWith('flight-'))
  expect(files).toHaveLength(1)
  expect(JSON.parse(readFileSync(join(dir, files[0]), 'utf8')).buffer).toEqual(buffer)
})

it('ignores feature assertions and unrelated files and contains diagnostics transport failure', () => {
  expect(saveColumnFlightAfterRecovery(true)).toBe(true)
  expect(phone.eval).not.toHaveBeenCalled()
  noteColumnPhoneFailure('columns.e2e.test.ts', 'case', ['expected 2 to equal 3'])
  noteColumnPhoneFailure('sample.e2e.test.ts', 'case', ['the phone gave no answer'])
  expect(phone.driver).not.toHaveBeenCalled()
  expect(existsSync(dir)).toBe(false)
  phone.eval.mockImplementation(() => {
    throw new Error('no answer')
  })
  expect(saveColumnFlightAfterRecovery()).toBe(false)
})

it('records unavailable native status without obscuring the original failed case', () => {
  phone.driver.mockImplementation(() => {
    throw new Error('native status unavailable')
  })
  expect(() =>
    noteColumnPhoneFailure('columnSafety.e2e.test.ts', 'failed case', [
      'phone driver failed: lost reply',
    ])
  ).not.toThrow()
  const saved = JSON.parse(readFileSync(join(dir, 'pending.json'), 'utf8'))
  expect(saved.test).toBe('failed case')
  expect(saved.liveness).toEqual({ status: 'unavailable' })
  expect(phone.driver).toHaveBeenCalledWith(['status'], 5000)
})

it('discards malformed status and allowlists native liveness without copying free text', () => {
  phone.driver.mockReturnValue(
    JSON.stringify({
      app: 'running',
      webContentRunning: true,
      device: 'sample-device',
      path: '/sample/private',
      message: 'sample secret',
    })
  )
  noteColumnPhoneFailure('columns.e2e.test.ts', 'case', ['phone driver failed: reply lost'])
  const pending = JSON.parse(readFileSync(join(dir, 'pending.json'), 'utf8'))
  expect(pending.liveness).toEqual({
    status: 'answered',
    appRunning: true,
    webContentRunning: true,
  })
  // Old workers may have left a raw native response in the pending marker.
  pending.liveness = { status: JSON.stringify({ app: 'running', message: 'sample secret' }) }
  writeFileSync(join(dir, 'pending.json'), JSON.stringify(pending))
  expect(saveColumnFlightAfterRecovery()).toBe(true)
  const saved = readFileSync(
    join(dir, readdirSync(dir).find((file) => file.startsWith('flight-'))!),
    'utf8'
  )
  expect(saved).not.toContain('sample secret')
  expect(JSON.parse(saved).failure.liveness).toEqual({ status: 'answered', appRunning: true })
})

it('does not retain malformed or oversized native responses', () => {
  phone.driver.mockReturnValue('\\'.repeat(8192))
  noteColumnPhoneFailure('columns.e2e.test.ts', 'case', ['phone driver failed: reply lost'])
  const pending = JSON.parse(readFileSync(join(dir, 'pending.json'), 'utf8'))
  expect(pending.liveness).toEqual({ status: 'answered' })
})

it('bounds oversized recovered storage and saves an explicit raw tail without parsing it', () => {
  const text = 'x'.repeat(300_000)
  phone.eval.mockImplementation((code: string) => {
    const result = new Function(
      'localStorage',
      'performance',
      'window',
      'StorageEvent',
      `return ${code}`
    )({ getItem: () => text }, { timeOrigin: 20 }, {}, class {})
    return '=> ' + JSON.stringify(result)
  })
  expect(saveColumnFlightAfterRecovery()).toBe(true)
  const saved = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8'))
  expect(saved.truncated).toBe(true)
  expect(saved.originalChars).toBe(300_000)
  expect(saved.buffer).toBe(null)
  expect(saved.bufferTextTail).toHaveLength(256 * 1024)
})

it('retains old evidence and suppresses rearming at the per-batch artifact limit', () => {
  mkdirSync(dir)
  for (let i = 0; i < 32; i++) writeFileSync(join(dir, `flight-${i}.json`), '{}')
  expect(enablePhoneColumnFlight()).toBe(false)
  expect(phone.eval.mock.calls.some(([code]) => code.includes('localStorage.setItem'))).toBe(false)
  expect(readdirSync(dir)).toHaveLength(32)
})
