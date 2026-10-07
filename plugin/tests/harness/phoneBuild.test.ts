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
  const page = {
    __abeleTest: api as object | null,
    __e2eInstalledBuild: loaded,
    __e2eJobs: {} as Record<string, { done: boolean }>,
  }
  let vault = 'sample-vault'
  const files = { ...bytes }
  if (change.endsWith('hash'))
    files[change.split(' ')[0] as keyof typeof files] = Buffer.from('different bytes')
  if (change === 'missing API') page.__abeleTest = null
  if (change === 'different vault') vault = 'another-sample-vault'
  if (change === 'stale generation') loaded.generation--
  if (change === 'replaced API') page.__abeleTest = {}
  if (change === 'unfinished page job') page.__e2eJobs.pending = { done: false }
  const app = {
    plugins: { loadingPluginId: change === 'plugin loader busy' ? 'sample-startup-addon' : null },
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
  'unfinished page job',
  'plugin loader busy',
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
    expect(phone.driver.mock.calls.filter(([args]) => args.includes('--fresh'))).toHaveLength(0)
  } finally {
    vi.useRealTimers()
  }
})

it.each(['unloaded', 'running', 'loader busy'])(
  'enables only an unloaded idle plugin before the reload request (%s)',
  async (mode) => {
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
    await installBuild(process.cwd())
    const code = phone.eval.mock.calls.find(([code]) => code.includes('location.reload'))![0]
    const events: string[] = []
    const plugins = {
      plugins: { abele: mode === 'running' ? {} : undefined },
      loadingPluginId: mode === 'loader busy' ? 'sample-startup-addon' : null,
      enablePlugin: vi.fn(async () => {
        events.push('enable')
      }),
    }
    await new Function('app', 'sessionStorage', 'setTimeout', 'return ' + code)(
      { plugins },
      {
        setItem: () => {
          events.push('witness')
        },
      },
      () => {
        events.push('reload')
      }
    )
    expect(plugins.enablePlugin).toHaveBeenCalledTimes(mode === 'unloaded' ? 1 : 0)
    if (mode === 'unloaded') {
      expect(plugins.enablePlugin).toHaveBeenCalledWith('abele')
      expect(events.indexOf('enable')).toBeLessThan(events.indexOf('reload'))
    }
    expect(events).toContain('witness')
    expect(events.at(-1)).toBe('reload')
  }
)

function stalledHost(mode: string) {
  const version = JSON.parse(manifest.toString()).version as string
  const state = {
    owner: 'sample-vault',
    generation: 10,
    requestId: null as string | null,
    mobile: true,
    apiReady: false,
    layoutReady: true,
    version: '',
    loadingPluginId: 'sample-startup-addon' as string | null,
    screen: { text: 'Sample startup overlay', readyState: 'complete', visibilityState: 'visible' },
  }
  let fresh = false
  phone.eval.mockImplementation((code) => {
    if (code.includes('SHA-256')) return '=> false'
    if (code.includes('location.reload')) {
      state.requestId = /sessionStorage.setItem\('[^']+', "([^"]+)"\)/.exec(code)![1]
      state.generation++
      return '=> ' + state.requestId
    }
    if (code.includes('performance.timeOrigin') && !code.includes('__e2eInstalledBuild =')) {
      if (fresh && mode === 'unreachable') throw Error('Sample page unavailable')
      return '=> ' + JSON.stringify(state)
    }
    if (code.includes('getName')) return '=> sample-vault'
    return '=> ready'
  })
  phone.driver.mockImplementation((args) => {
    if (args[0] === 'alert') return '{"alert":null,"text":["Sample native screen"]}'
    if (args[0] !== 'launch') return 'ok'
    expect(args).toEqual(['launch', 'md.obsidian', '--fresh'])
    fresh = true
    if (mode === 'launch failure') throw Error('Sample launch transport failure')
    if (mode !== 'unchanged generation') state.generation++
    state.apiReady = true
    state.version = mode === 'wrong version' ? '0.0.0' : version
    if (mode === 'wrong vault') state.owner = 'another-sample-vault'
    if (mode === 'layout pending') state.layoutReady = false
    if (mode !== 'stays loading') {
      setTimeout(() => {
        state.loadingPluginId = null
        state.screen.text = 'Sample workspace'
      }, 2000)
    }
    if (mode === 'lost acknowledgement') throw Error('Sample launch acknowledgement lost')
    return '{"ok":true}'
  })
  return { version, state }
}

it.each(['recovers', 'lost acknowledgement'])(
  'fresh-launches only after the initial deadline and waits for the loader to clear (%s)',
  async (mode) => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const host = stalledHost(mode)
      const result = installBuild(process.cwd()).catch((error) => error)
      await vi.advanceTimersByTimeAsync(119750)
      expect(phone.driver.mock.calls.filter(([args]) => args[0] === 'launch')).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(250)
      expect(phone.driver.mock.calls.filter(([args]) => args.includes('--fresh'))).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1750)
      expect(phone.eval.mock.calls.some(([code]) => code.includes('__e2eInstalledBuild ='))).toBe(
        false
      )
      await vi.runAllTimersAsync()
      expect(await result).toBe(host.version)
      expect(host.state.loadingPluginId).toBeNull()
      expect(phone.driver.mock.calls.filter(([args]) => args[0] === 'push-plugin')).toHaveLength(1)
      expect(
        phone.eval.mock.calls.filter(([code]) => code.includes('location.reload'))
      ).toHaveLength(1)
      expect(phone.driver.mock.calls.filter(([args]) => args.includes('--fresh'))).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  }
)

it.each([
  'stays loading',
  'wrong version',
  'wrong vault',
  'unchanged generation',
  'layout pending',
  'unreachable',
  'launch failure',
])(
  'bounds one fresh launch and reports loader/screen diagnostics when recovery fails: %s',
  async (mode) => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      stalledHost(mode)
      const result = installBuild(process.cwd()).catch((error) => error)
      await vi.runAllTimersAsync()
      const error = await result
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('loadingPluginId')
      expect(error.message).toContain('screen')
      expect(error.message).toContain('Sample')
      expect(phone.driver.mock.calls.filter(([args]) => args.includes('--fresh'))).toHaveLength(1)
      expect(phone.driver.mock.calls.filter(([args]) => args[0] === 'push-plugin')).toHaveLength(1)
      expect(phone.eval.mock.calls.some(([code]) => code.includes('__e2eInstalledBuild ='))).toBe(
        false
      )
      expect(Date.now()).toBe(240000)
      if (mode === 'stays loading') {
        expect(error.message).toContain('sample-startup-addon')
        expect(error.message).toContain('Sample startup overlay')
      }
      if (mode === 'unreachable') expect(error.message).toContain('Sample page unavailable')
      if (mode === 'launch failure')
        expect(error.message).toContain('Sample launch transport failure')
    } finally {
      vi.useRealTimers()
    }
  }
)

it('waits out the initial allowance when startup has no readable page, then recovers once', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  try {
    const host = stalledHost('recovers')
    const evaluate = phone.eval.getMockImplementation()!
    phone.eval.mockImplementation((code) => {
      if (
        code.includes('performance.timeOrigin') &&
        !code.includes('SHA-256') &&
        !phone.driver.mock.calls.some(([args]) => args.includes('--fresh'))
      )
        throw Error('Sample startup page unavailable')
      return evaluate(code)
    })
    const result = installBuild(process.cwd()).catch((error) => error)
    await vi.advanceTimersByTimeAsync(119750)
    expect(phone.driver.mock.calls.filter(([args]) => args[0] === 'launch')).toHaveLength(0)
    await vi.runAllTimersAsync()
    expect(await result).toBe(host.version)
    expect(phone.driver.mock.calls.filter(([args]) => args.includes('--fresh'))).toHaveLength(1)
  } finally {
    vi.useRealTimers()
  }
})

it('reads the loader ID and bounded visible screen text from the actual page probe', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  try {
    const host = stalledHost('recovers')
    const result = installBuild(process.cwd())
    await vi.runAllTimersAsync()
    await result
    const code = phone.eval.mock.calls.find(([code]) => code.includes('screen:'))![0]
    const plugins = {
      loadingPluginId: 'sample-startup-addon' as string | null,
      plugins: { abele: { manifest: { version: host.version } } },
    }
    const page = {
      app: {
        plugins,
        vault: { getName: () => 'sample-vault' },
        isMobile: true,
        workspace: { layoutReady: true },
      },
      __abeleTest: {},
    }
    const screen = {
      body: { innerText: 'Sample overlay '.repeat(200) },
      readyState: 'complete',
      visibilityState: 'visible',
    }
    const probe = () =>
      JSON.parse(
        new Function('window', 'document', 'performance', 'sessionStorage', 'return ' + code)(
          page,
          screen,
          { timeOrigin: 50 },
          { getItem: () => null }
        )
      )
    expect(probe()).toMatchObject({
      loadingPluginId: 'sample-startup-addon',
      apiReady: false,
      screen: { readyState: 'complete', visibilityState: 'visible' },
    })
    expect(probe().screen.text).toHaveLength(1000)
    plugins.loadingPluginId = null
    plugins.plugins.abele.manifest.version = '0.0.0'
    expect(probe().apiReady).toBe(false)
    plugins.plugins.abele.manifest.version = host.version
    expect(probe().apiReady).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

it('preserves loader/page diagnostics even when the native screen query also fails', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  try {
    stalledHost('stays loading')
    const drive = phone.driver.getMockImplementation()!
    phone.driver.mockImplementation((args) => {
      if (args[0] === 'alert') throw Error('Sample native screen unavailable')
      return drive(args)
    })
    const result = installBuild(process.cwd()).catch((error) => error)
    await vi.runAllTimersAsync()
    expect((await result).message).toContain('sample-startup-addon')
    expect((await result).message).toContain('Sample startup overlay')
    expect((await result).message).toContain('Sample native screen unavailable')
    expect(phone.driver.mock.calls.filter(([args]) => args.includes('--fresh'))).toHaveLength(1)
  } finally {
    vi.useRealTimers()
  }
})
