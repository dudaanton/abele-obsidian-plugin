import { afterEach, expect, it, vi } from 'vitest'
import { reloadApp } from '../e2e/helpers/obsidianCli'
import { evalSource, evalOutput } from '../helpers/cliProtocolMock'

const phone = vi.hoisted(() => ({ eval: vi.fn(), install: vi.fn(), driver: vi.fn() }))
vi.mock('../e2e/helpers/target', () => ({ onPhone: () => true }))
vi.mock('../e2e/helpers/phone', () => ({
  phoneEval: phone.eval,
  driver: phone.driver,
  PHONE_VAULT: 'sample-vault',
  installPhoneHost: phone.install,
  assertPhoneTransport: vi.fn(),
}))
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('recovers a chooser while preserving the unconfirmed reload failure', async () => {
  vi.useFakeTimers()
  let requested = false
  let recovered = false
  phone.driver.mockImplementation(() => {
    recovered = true
    return '{"actions":["open"]}'
  })
  phone.eval.mockImplementation((wrapped) => {
    const code = evalSource(wrapped)
    if (code.includes('location.reload')) {
      requested = true
      return evalOutput(wrapped, '=> lost')
    }
    if (code.includes('!!window.app')) return evalOutput(wrapped, '=> false')
    if (requested && !recovered) throw Error("Can't find variable: app")
    return evalOutput(
      wrapped,
      '=> ' +
        JSON.stringify({
          owner: 'sample-vault',
          generation: recovered ? 20 : 10,
          requestId: null,
          mobile: true,
          apiReady: true,
          layoutReady: true,
        })
    )
  })
  const result = reloadApp().catch((error) => error)
  await vi.runAllTimersAsync()
  expect((await result).message).toContain('Reload unconfirmed')
  expect(phone.driver).toHaveBeenCalledWith(
    ['open-vault', 'sample-vault', '--timeout', '60'],
    90000
  )
  expect(phone.install).toHaveBeenCalledOnce()
})

it('confirms a new ready generation rather than the old API or a fixed sleep', async () => {
  vi.useFakeTimers()
  let generation = 10,
    requestId: string | null = null,
    ready = false
  phone.eval.mockImplementation((wrapped) => {
    const code = evalSource(wrapped)
    if (code.includes('location.reload')) {
      requestId = /sessionStorage.setItem\('[^']+', "([^"]+)"\)/.exec(code)![1]
      return evalOutput(wrapped, '=> ' + requestId)
    }
    return evalOutput(
      wrapped,
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
  phone.eval.mockImplementation((wrapped) => {
    if (evalSource(wrapped).includes('!!window.app')) return evalOutput(wrapped, '=> true')
    return evalOutput(
      wrapped,
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
  })
  const result = reloadApp().catch((error) => error)
  await vi.runAllTimersAsync()
  expect((await result).message).toContain('Reload unconfirmed')
  expect(phone.install).not.toHaveBeenCalled()
  expect(phone.driver).not.toHaveBeenCalled()
})
