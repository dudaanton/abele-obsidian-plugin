import { beforeEach, expect, it, vi } from 'vitest'
import { copyMapLocation } from '@/maps/copyLocation'
import { LocationRequestError } from '@/location/currentLocation'

const fake = vi.hoisted(() => ({ get: vi.fn(), notices: [] as string[], hide: vi.fn() }))
vi.mock('@/services/DeviceLocation', () => ({ getDeviceLocation: fake.get }))
vi.mock('obsidian', async (original) => ({
  ...(await original<object>()),
  Notice: class {
    constructor(message: string) {
      fake.notices.push(message)
    }
    hide = fake.hide
  },
}))
beforeEach(() => {
  vi.restoreAllMocks()
  fake.get.mockReset()
  fake.notices.length = 0
  fake.hide.mockClear()
})

it('copies only the acquired coordinates and dismisses the waiting notice', async () => {
  fake.get.mockResolvedValue({ latitude: 0, longitude: 12, accuracy: 3 })
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  await copyMapLocation()
  expect(write).toHaveBeenCalledWith('0, 12')
  expect(fake.notices.at(-1)).toBe('Coordinates copied')
  expect(fake.hide).toHaveBeenCalledOnce()
})
it.each([
  [1, 'Location permission denied'],
  [3, 'Location request timed out'],
  [2, 'Location information unavailable'],
])('explains location error %s without copying', async (code, message) => {
  fake.get.mockRejectedValue(new LocationRequestError(Number(code), 'provider detail'))
  const write = vi.spyOn(navigator.clipboard, 'writeText')
  await copyMapLocation()
  expect(write).not.toHaveBeenCalled()
  expect(fake.notices.at(-1)).toBe(message)
  expect(fake.hide).toHaveBeenCalledOnce()
})
it('distinguishes clipboard refusal from location refusal', async () => {
  fake.get.mockResolvedValue({ latitude: 1, longitude: 2 })
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(Error('clipboard'))
  await copyMapLocation()
  expect(fake.notices.at(-1)).toBe('Could not copy coordinates')
})
