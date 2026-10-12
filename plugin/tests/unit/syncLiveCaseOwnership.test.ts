// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runLiveCase } from '../e2e/helpers/syncLiveCases'
import type { TokenSyncLive } from '../e2e/helpers/tokenSyncLive'
vi.mock('../e2e/helpers/tokenSyncLive', () => ({ TokenSyncLive: class {} }))
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  const mkdirSync = vi.fn(),
    writeFileSync = vi.fn()
  return {
    ...actual,
    mkdirSync,
    writeFileSync,
    default: { ...actual.default, mkdirSync, writeFileSync },
  }
})
vi.mock('../e2e/helpers/target', () => ({ onPhone: () => false }))
vi.mock('../e2e/helpers/shots', () => ({ shotDir: () => 'synthetic-evidence' }))
vi.mock('../e2e/helpers/phone', () => ({ driver: vi.fn(), PHONE_VAULT: 'phone' }))

it('never records verified evidence for a body that finishes after timeout teardown', async () => {
  const current = {
    primary: { ended: true, run: vi.fn(), failure: () => new Error('late evidence') },
    close: vi.fn(async () => {}),
  }
  await expect(
    runLiveCase(
      'syncDevices',
      'late success',
      [24],
      async () => {
        expect(true).toBe(true)
      },
      () => current as unknown as TokenSyncLive
    )
  ).rejects.toThrow('case ended')
})

it('a late timed-out body cleans its own fixture rather than the next case', async () => {
  const make = () => ({
    primary: { run: vi.fn(), failure: () => new Error('old failure') },
    close: vi.fn(async () => {}),
  })
  const old = make(),
    next = make()
  let current = old,
    release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const job = runLiveCase(
    'syncDevices',
    'late case',
    [24],
    async () => {
      await waiting
      throw new Error('old body timed out')
    },
    () => current as unknown as TokenSyncLive
  )
  current = next
  release()
  await expect(job).rejects.toThrow('old body timed out')
  expect(old.close).toHaveBeenCalledOnce()
  expect(next.close).not.toHaveBeenCalled()
  expect(next.primary.run).not.toHaveBeenCalled()
})

it('cleans its fixture even when failure diagnostics throw', async () => {
  const current = {
    primary: {
      run: vi.fn(),
      failure: () => {
        throw new Error('sample diagnostic failure')
      },
    },
    close: vi.fn(async () => {}),
  }
  await expect(
    runLiveCase(
      'syncSettings',
      'failed sample',
      [1],
      async () => {
        throw new Error('sample body failure')
      },
      () => current as unknown as TokenSyncLive
    )
  ).rejects.toThrow()
  expect(current.close).toHaveBeenCalledOnce()
})
