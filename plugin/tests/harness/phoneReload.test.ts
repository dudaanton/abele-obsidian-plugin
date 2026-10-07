import { afterEach, expect, it, vi } from 'vitest'
import { reloadApp } from '../e2e/helpers/obsidianCli'

const phone = vi.hoisted(() => ({ eval: vi.fn(), install: vi.fn() }))
vi.mock('../e2e/helpers/target', () => ({ onPhone: () => true }))
vi.mock('../e2e/helpers/phone', () => ({
  phoneEval: phone.eval,
  installPhoneHost: phone.install,
  assertPhoneTransport: vi.fn(),
}))
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('confirms a new ready generation rather than the old API or a fixed sleep', async () => {
  vi.useFakeTimers()
  let generation = 10,
    requestId: string | null = null,
    ready = false
  phone.eval.mockImplementation((code) => {
    if (code.includes('location.reload')) {
      requestId = /sessionStorage.setItem\('[^']+', "([^"]+)"\)/.exec(code)![1]
      return '=> ' + requestId
    }
    return (
      '=> ' +
      JSON.stringify({
        owner: 'sample-vault',
        generation,
        requestId,
        mobile: true,
        apiReady: ready,
        layoutReady: ready,
      })
    )
  })
  const result = reloadApp()
  await vi.advanceTimersByTimeAsync(250)
  expect(phone.install).not.toHaveBeenCalled()
  generation++
  await vi.advanceTimersByTimeAsync(250)
  expect(phone.install).not.toHaveBeenCalled()
  ready = true
  await vi.advanceTimersByTimeAsync(250)
  await expect(result).resolves.toBeUndefined()
  expect(phone.install).toHaveBeenCalledOnce()
  expect(phone.eval.mock.calls.filter(([code]) => code.includes('location.reload'))).toHaveLength(1)
})

it('keeps the reload deadline when only the old generation answers', async () => {
  vi.useFakeTimers()
  phone.eval.mockReturnValue(
    '=> ' +
      JSON.stringify({
        owner: 'sample-vault',
        generation: 10,
        requestId: null,
        mobile: true,
        apiReady: true,
        layoutReady: true,
      })
  )
  const result = reloadApp().catch((error) => error)
  await vi.runAllTimersAsync()
  expect((await result).message).toContain('Reload unconfirmed')
  expect(phone.install).not.toHaveBeenCalled()
})
