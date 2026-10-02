import { beforeEach, expect, it, vi } from 'vitest'
import { installPhoneHost, phoneEval } from '../e2e/helpers/phone'

const exec = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  default: { execFileSync: exec },
  execFileSync: exec,
}))
beforeEach(() => exec.mockReset())

it('reports a host failure before a caller tries to parse a feature report', () => {
  exec.mockReturnValue(
    JSON.stringify({ thrown: 'Phone host transport (swipe): network connection lost' })
  )
  expect(() => phoneEval('probe()', 1000)).toThrow(
    /phone host transport.*swipe.*network connection lost/i
  )
})

it('does not classify a feature exception as transport', () => {
  exec.mockReturnValue(JSON.stringify({ thrown: 'Error: missing timeline' }))
  expect(phoneEval('probe()', 1000)).toBe('Error: missing timeline')
})

it('names malformed driver output as transport instead of throwing a JSON syntax error', () => {
  exec.mockReturnValue('Error: Request lost')
  expect(() => phoneEval('probe()', 1000)).toThrow(/phone.*transport.*Request lost/i)
})

it('preserves the host operation on reversed-port failure and never retries a gesture', async () => {
  vi.stubEnv('ABELE_PHONE_HOST_PORT', '12345')
  try {
    exec.mockReturnValue(JSON.stringify({ type: 'string', value: 'ok' }))
    installPhoneHost()
    const code = exec.mock.calls[0][1].at(-1)
    const page: { __e2eHost?: { swipe: (...args: number[]) => Promise<unknown> } } = {}
    const request = vi.fn().mockRejectedValue(new Error('connection lost'))
    new Function('window', 'requestUrl', 'setTimeout', code)(page, request, () => 0)
    await expect(page.__e2eHost!.swipe(1, 2, 3, 4)).rejects.toThrow(
      /Phone host transport \(swipe\).*connection lost/
    )
    expect(request).toHaveBeenCalledOnce()
  } finally {
    vi.unstubAllEnvs()
  }
})
