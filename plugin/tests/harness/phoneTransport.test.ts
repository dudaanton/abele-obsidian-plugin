import { beforeEach, expect, it, vi } from 'vitest'
import { beginPhoneCase, endPhoneCase, installPhoneHost, phoneEval } from '../e2e/helpers/phone'

const exec = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  default: { execFileSync: exec },
  execFileSync: exec,
}))
beforeEach(() => {
  exec.mockReset()
  endPhoneCase()
})

const identity = { timeOrigin: 123, loadId: 'first-load' }
const envelope = (value: unknown) => JSON.stringify({ type: 'object', value })
it('retries a lost eval reply once using the same job without repeating mutations', () => {
  exec.mockReturnValueOnce(envelope(identity))
  beginPhoneCase()
  exec
    .mockReturnValueOnce('')
    .mockReturnValueOnce(envelope({ identity, answer: { type: 'number', value: 7 } }))
  expect(phoneEval('window.mutations++;7', 1000)).toBe('=> 7')
  expect(exec.mock.calls[1][1]).toEqual(exec.mock.calls[2][1])
})
it('reports reload before executing an action in the replacement WebView', () => {
  exec.mockReturnValueOnce(envelope(identity))
  beginPhoneCase()
  exec.mockImplementationOnce(() => {
    throw Object.assign(new Error('driver'), { stderr: 'JSONDecodeError: empty reply' })
  })
  exec.mockReturnValueOnce(
    envelope({ identity: { timeOrigin: 456, loadId: 'new-load' }, answer: { type: 'undefined' } })
  )
  expect(() => phoneEval('mutate()', 1000)).toThrow('Obsidian was reloaded during the case')
  expect(exec).toHaveBeenCalledTimes(3)
})
it('keeps a repeated driver failure distinct from a reload', () => {
  exec.mockReturnValueOnce(envelope(identity))
  beginPhoneCase()
  exec.mockReturnValue('')
  expect(() => phoneEval('probe()', 1000)).toThrow(/phone.*transport/)
  expect(exec).toHaveBeenCalledTimes(3)
})
it('the page job executes once and refuses a replacement load before mutating it', async () => {
  exec.mockReturnValueOnce(envelope(identity))
  beginPhoneCase()
  exec.mockReturnValue(envelope({ identity, answer: { type: 'number', value: 1 } }))
  phoneEval('++window.mutations', 1000)
  const code = exec.mock.calls[1][1].at(-1)
  const evaluate = new Function('window', 'performance', `return ${code}`)
  const page = { __abelePhoneLoadIdentity: identity, mutations: 0 }
  await Promise.all([evaluate(page, { timeOrigin: 123 }), evaluate(page, { timeOrigin: 123 })])
  expect(page.mutations).toBe(1)
  const replacement = { mutations: 0 }
  const reply = await evaluate(replacement, { timeOrigin: 456 })
  expect(replacement.mutations).toBe(0)
  expect(reply.identity.timeOrigin).toBe(456)
  expect(reply.answer).toBeUndefined()
})

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
