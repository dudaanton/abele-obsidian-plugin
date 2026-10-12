// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { SCRIPT_FIXTURE, type ScriptFixtureSnapshot } from '../e2e/helpers/scriptFixture'

const registryKey = 'abele-sync-connections-v2'
const legacyKey = 'abele-sync-connection'
function fixture(registry: unknown = null, legacy: unknown = null) {
  const local = new Map<string, unknown>([
    [registryKey, registry],
    [legacyKey, legacy],
  ])
  const config = {
    ai: { enabled: false, scriptsEnabled: false },
    version: { value: 0 },
    saveSettings: vi.fn(async () => {}),
  }
  const host = {
    live: new Map(),
    pending: new Set(),
    startupCancels: new Map(),
    engines: { runtimes: new Map() },
    ui: { runtimes: new Map() },
    closed: false,
    rebuilding: Promise.resolve(),
  }
  const app = {
    loadLocalStorage: (key: string) => local.get(key) ?? null,
    saveLocalStorage: vi.fn((key: string, value: unknown) => {
      local.set(key, structuredClone(value))
    }),
    plugins: { plugins: { abele: { tokenEngines: host } } },
    vault: {
      adapter: { exists: vi.fn(async () => false) },
      getConfig: () => null,
      setConfig: vi.fn(),
      saveConfig: vi.fn(async () => {}),
    },
  }
  const window = {
    __abeleTest: {
      AbeleConfig: { getInstance: () => config },
      ScriptTrust: { reset: vi.fn() },
      ScriptService: { getInstance: () => ({ discover: vi.fn(async () => {}) }) },
    },
  }
  const api = new Function(
    'app',
    'window',
    `${SCRIPT_FIXTURE}; return {saveScriptFixture, restoreScriptFixture}`
  )(app, window) as {
    saveScriptFixture(): Promise<ScriptFixtureSnapshot>
    restoreScriptFixture(snapshot: ScriptFixtureSnapshot): Promise<void>
  }
  return { ...api, local, app, host, config }
}
const retained = {
  version: 2,
  selectedId: 'sample-retained',
  records: [
    {
      id: 'sample-retained',
      address: 'https://sync.example',
      secretReference: 'sample-secret-reference',
      status: 'offline',
    },
  ],
}
const legacy = { serverUrl: 'https://legacy.example', vaultId: 'sample-vault' }
it('owns a disconnected context and restores exact retained token and legacy metadata', async () => {
  const f = fixture(retained, legacy)
  const saved = await f.saveScriptFixture()
  expect(f.local.get(registryKey)).toEqual({ version: 2, selectedId: '', records: [] })
  expect(f.local.get(legacyKey)).toBeNull()
  await f.restoreScriptFixture(saved)
  expect(f.local.get(registryKey)).toEqual(retained)
  expect(f.local.get(legacyKey)).toEqual(legacy)
})
it('restores absent keys without leaving an empty registry installed', async () => {
  const f = fixture()
  const saved = await f.saveScriptFixture()
  await f.restoreScriptFixture(saved)
  expect(f.local.get(registryKey)).toBeNull()
  expect(f.local.get(legacyKey)).toBeNull()
})
it('restores connection keys even when script cleanup fails', async () => {
  const f = fixture(retained, legacy)
  const saved = await f.saveScriptFixture()
  f.config.saveSettings.mockRejectedValueOnce(new Error('sample cleanup failure'))
  await expect(f.restoreScriptFixture(saved)).rejects.toThrow('sample cleanup failure')
  expect(f.local.get(registryKey)).toEqual(retained)
  expect(f.local.get(legacyKey)).toEqual(legacy)
})
it.each(['live', 'pending', 'startupCancels', 'queued'] as const)(
  'refuses an active %s without touching storage',
  async (kind) => {
    const f = fixture()
    if (kind === 'queued') f.host.engines.runtimes.set('sample', {})
    else if (kind === 'pending') f.host.pending.add('sample')
    else f.host[kind].set('sample', {})
    await expect(f.saveScriptFixture()).rejects.toThrow('exclusively held')
    expect(f.app.saveLocalStorage).not.toHaveBeenCalled()
  }
)
it('rolls back the disconnected context if installation fails', async () => {
  const f = fixture(retained, legacy)
  f.app.saveLocalStorage.mockImplementationOnce(() => {
    throw new Error('sample install failure')
  })
  await expect(f.saveScriptFixture()).rejects.toThrow('sample install failure')
  expect(f.local.get(registryKey)).toEqual(retained)
  expect(f.local.get(legacyKey)).toEqual(legacy)
})

it('restores the legacy key even when restoring the token registry fails', async () => {
  const f = fixture(retained, legacy)
  const saved = await f.saveScriptFixture()
  const write = f.app.saveLocalStorage.getMockImplementation()!
  f.app.saveLocalStorage.mockImplementation((key, value) => {
    if (key === registryKey) throw new Error('sample registry write failed')
    write(key, value)
  })
  await expect(f.restoreScriptFixture(saved)).rejects.toThrow('sample registry write failed')
  expect(f.local.get(legacyKey)).toEqual(legacy)
})

it('keeps the baseline feature flags and source policy assertions while isolating sync', async () => {
  const f = fixture(retained, legacy)
  const policy = { version: 1, sample: { sha: 'a'.repeat(64), confirmed: true } }
  f.local.set('abele-script-trust', policy)
  const saved = await f.saveScriptFixture()
  f.local.set('abele-script-trust', { sample: 'changed' })
  f.config.ai = { enabled: true, scriptsEnabled: true }
  await f.restoreScriptFixture(saved)
  expect(f.config.ai).toEqual(saved.ai)
  expect(f.local.get('abele-script-trust')).toEqual(policy)
  expect(f.local.get(registryKey)).toEqual(retained)
})

it('finishes queued settings rebuilds before restoring retained connection records', async () => {
  const f = fixture(retained, legacy)
  const saved = await f.saveScriptFixture()
  let finish!: () => void
  const observed: unknown[] = []
  f.config.saveSettings.mockImplementation(async () => {
    if (f.config.saveSettings.mock.calls.length === 1) return
    f.host.rebuilding = new Promise<void>((resolve) => {
      finish = resolve
    }).then(() => {
      observed.push(f.local.get(registryKey))
    })
  })
  const restoring = f.restoreScriptFixture(saved)
  // Both settings writes queue the host's latest rebuild, as in the app's onSaved hook.
  for (let i = 0; i < 12; i++) await Promise.resolve()
  expect(f.local.get(registryKey)).toEqual({ version: 2, selectedId: '', records: [] })
  finish()
  await restoring
  expect(observed).toEqual([{ version: 2, selectedId: '', records: [] }])
  expect(f.local.get(registryKey)).toEqual(retained)
})
