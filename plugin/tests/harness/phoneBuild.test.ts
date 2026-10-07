import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import { join } from 'node:path'
import { installBuild } from '../e2e/helpers/phoneHost'

const phone = vi.hoisted(() => ({ driver: vi.fn(), eval: vi.fn() }))
vi.mock('../e2e/helpers/phone', () => ({
  DRIVER: 'sample-driver',
  PHONE_VAULT: 'sample-vault',
  driver: phone.driver,
  phoneEval: phone.eval,
  exposeToPhone: vi.fn(),
  installPhoneHost: vi.fn(),
  swipeDriverArgs: vi.fn(),
}))
const dir = join(process.cwd(), 'node_modules/sample-phone-build')
const manifest = readFileSync(join(process.cwd(), '../manifest.json'))
const bytes = {
  'main.js': Buffer.from('sample code'),
  'styles.css': Buffer.from('sample styles'),
  'manifest.json': manifest,
}
const hashes = Object.fromEntries(
  Object.entries(bytes).map(([name, data]) => [
    name,
    createHash('sha256').update(data).digest('hex'),
  ])
)
beforeEach(() => {
  mkdirSync(dir, { recursive: true })
  for (const [file, data] of Object.entries(bytes)) writeFileSync(join(dir, file), data)
  vi.stubEnv('ABELE_PHONE_BUILD', dir)
  phone.driver.mockReset()
  phone.eval.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

async function installedProbe(change: string) {
  phone.eval.mockReturnValue('=> true')
  await installBuild(process.cwd())
  const code = phone.eval.mock.calls[0][0]
  const api = {}
  const loaded = { hashes: { ...hashes }, api, generation: 10 }
  const page = { __abeleTest: api as object | null, __e2eInstalledBuild: loaded }
  let vault = 'sample-vault'
  const files = { ...bytes }
  if (change.endsWith('hash'))
    files[change.split(' ')[0] as keyof typeof files] = Buffer.from('different bytes')
  if (change === 'missing API') page.__abeleTest = null
  if (change === 'different vault') vault = 'another-sample-vault'
  if (change === 'stale generation') loaded.generation--
  if (change === 'replaced API') page.__abeleTest = {}
  const app = {
    vault: {
      getName: () => vault,
      configDir: '.sample',
      adapter: {
        readBinary: async (path: string) => {
          if (change === 'unreadable files') throw Error('not readable')
          const buffer = files[path.split('/').pop() as keyof typeof files]
          return Uint8Array.from(buffer).buffer
        },
      },
    },
  }
  return new Function('window', 'app', 'performance', 'crypto', 'return ' + code)(
    page,
    app,
    { timeOrigin: 10 },
    webcrypto
  )
}

it('does not push or reload a verified running build', async () => {
  await expect(installedProbe('matching')).resolves.toBe(true)
  expect(phone.driver).not.toHaveBeenCalled()
  expect(phone.eval.mock.calls.some(([code]) => code.includes('location.reload'))).toBe(false)
})

it.each([
  'main.js hash',
  'styles.css hash',
  'manifest.json hash',
  'missing API',
  'different vault',
  'stale generation',
  'replaced API',
])('does not accept %s as an installed build', async (change) => {
  await expect(installedProbe(change)).resolves.toBe(false)
})
it('does not accept unreadable installed files', async () => {
  await expect(installedProbe('unreadable files')).rejects.toThrow('not readable')
})

it.each(['=> false', 'Error: files not readable'])(
  'installs after an unverified probe (%s), but rejects the old generation',
  async (answer) => {
    phone.eval.mockImplementation((code) => {
      if (code.includes('SHA-256')) return answer
      if (code.includes('performance.timeOrigin'))
        return (
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
      if (code.includes('getName')) return '=> sample-vault'
      return '=> ok'
    })
    vi.useFakeTimers()
    try {
      const result = installBuild(process.cwd()).catch((error) => error)
      await vi.runAllTimersAsync()
      expect(phone.driver).toHaveBeenCalledWith(
        expect.arrayContaining(['push-plugin']),
        expect.any(Number)
      )
      expect(await result).toBeInstanceOf(Error)
      expect((await result).message).toContain('Reload unconfirmed')
    } finally {
      vi.useRealTimers()
    }
  }
)

it('records the verified hashes only after a new generation and its API are ready', async () => {
  vi.useFakeTimers()
  let generation = 10,
    requestId: string | null = null
  phone.eval.mockImplementation((code) => {
    if (code.includes('SHA-256')) return '=> false'
    if (code.includes('location.reload')) {
      requestId = /sessionStorage.setItem\('[^']+', "([^"]+)"\)/.exec(code)![1]
      generation++
      return '=> ' + requestId
    }
    if (code.includes('performance.timeOrigin') && !code.includes('__e2eInstalledBuild ='))
      return (
        '=> ' +
        JSON.stringify({
          owner: 'sample-vault',
          generation,
          requestId,
          mobile: true,
          apiReady: true,
          layoutReady: true,
        })
      )
    return '=> sample-vault'
  })
  try {
    await expect(installBuild(process.cwd())).resolves.toBe(JSON.parse(manifest.toString()).version)
    expect(phone.eval.mock.calls.at(-1)![0]).toContain('__e2eInstalledBuild =')
  } finally {
    vi.useRealTimers()
  }
})
