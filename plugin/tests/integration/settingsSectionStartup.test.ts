import { afterEach, expect, it, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'
import { startSettingsSectionStorage } from '@/sync/settingsSectionStartup'

const configs: AbeleConfig[] = []
const disposals: (() => void)[] = []
afterEach(() => {
  configs.splice(0).forEach((config) => config.destroy())
  disposals.splice(0).forEach((dispose) => dispose())
  vi.restoreAllMocks()
})

it('offers a visible reload retry after opening fails, and retries storage on the next startup', async () => {
  const open = vi
    .fn()
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockResolvedValue(undefined)
  const register = (dispose: () => void) => disposals.push(dispose)
  const retry = vi.fn(async () => {
    expect(await startSettingsSectionStorage(open, retry, register)).toBe(true)
  })
  expect(await startSettingsSectionStorage(open, retry, register)).toBe(false)
  const notice = document.querySelector('.notice')!
  expect(notice.textContent).toContain('defaults')
  expect(notice.textContent).toContain('saving paused')
  const button = notice.querySelector('button')!
  expect(button.textContent).toContain('reload')
  button.click()
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2))
  expect(retry).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(document.body.contains(notice)).toBe(false))
})

it('starts a genuinely cold configuration on usable defaults while section storage is unavailable', async () => {
  useVault([])
  const config = Reflect.construct(AbeleConfig, []) as AbeleConfig
  configs.push(config)
  expect(config.ai).toBeUndefined()
  expect(config.reader).toBeUndefined()
  const disk = new FakeSettings({ reader: { fontSize: 180 }, ai: { enabled: true } })
  config.init(disk as never, true)
  expect(
    await startSettingsSectionStorage(
      async () => {
        throw new Error('IndexedDB opening failed')
      },
      async () => {},
      (dispose) => disposals.push(dispose)
    )
  ).toBe(false)
  await expect(config.loadSettings()).rejects.toThrow('section storage')
  expect(config.ai).toBeDefined()
  expect(config.ai.enabled).toBe(false)
  expect(config.reader).toBeDefined()
  expect(config.reader.fontSize).not.toBe(180)
  expect(() => config.exportSettings()).not.toThrow()
  await expect(config.saveSettings()).rejects.toThrow('section storage')
  expect(disk.saved).toEqual([])
  expect(disk.stored).toEqual({ reader: { fontSize: 180 }, ai: { enabled: true } })
})

it('keeps the recovery notice actionable when a reload attempt fails', async () => {
  const retry = vi
    .fn()
    .mockRejectedValueOnce(new Error('reload unavailable'))
    .mockResolvedValue(undefined)
  await startSettingsSectionStorage(
    async () => {
      throw new Error('storage unavailable')
    },
    retry,
    (dispose) => disposals.push(dispose)
  )
  const notice = document.querySelector('.notice')!
  const button = notice.querySelector('button')!
  button.click()
  button.click()
  await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1))
  expect(document.body.contains(notice)).toBe(true)
  await vi.waitFor(() => {
    button.click()
    expect(retry).toHaveBeenCalledTimes(2)
  })
  await vi.waitFor(() => expect(document.body.contains(notice)).toBe(false))
  expect(retry).toHaveBeenCalledTimes(2)
})
