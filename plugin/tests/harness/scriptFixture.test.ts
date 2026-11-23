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
const folderSources = { 'sample.js': '// @name Sample recovery fixture\nreturn "sample"' }
function folderFixture(files: Record<string, string>) {
  const contents = new Map(Object.entries(files))
  let exists = true
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) =>
        exists
          ? {
              path,
              children: [...contents.keys()]
                .filter((name) => !name.startsWith('.'))
                .map((name) => ({ path: path + '/' + name })),
            }
          : null,
      adapter: {
        read: async (path: string) => contents.get(path.slice(path.indexOf('/') + 1)),
        list: vi.fn(async (path: string) => ({
          files: [...contents.keys()]
            .filter((name) => !name.includes('/'))
            .map((name) => path + '/' + name),
          folders: [
            ...new Set(
              [...contents.keys()]
                .filter((name) => name.includes('/'))
                .map((name) => path + '/' + name.split('/')[0])
            ),
          ],
        })),
      },
      delete: vi.fn(async () => {
        contents.clear()
        exists = false
      }),
      createFolder: vi.fn(async () => {
        exists = true
      }),
      create: vi.fn(async (path: string, source: string) => {
        contents.set(path.slice(path.indexOf('/') + 1), source)
      }),
    },
  }
  const api = new Function(
    'app',
    `${SCRIPT_FIXTURE}; return {prepareScriptFixtureFolder, removeScriptFixtureFolder}`
  )(app) as {
    prepareScriptFixtureFolder(folder: string, sources: Record<string, string>): Promise<void>
    removeScriptFixtureFolder(folder: string, sources: Record<string, string>): Promise<void>
  }
  return { ...api, app, contents }
}
it('recovers an exact synthetic folder left by an earlier run and marks the fresh folder', async () => {
  const f = folderFixture(folderSources)
  await f.prepareScriptFixtureFolder('Sample', folderSources)
  expect(f.app.vault.delete).toHaveBeenCalledTimes(1)
  expect(f.contents.get('abele-test-script-fixture.txt')).toBe('abele-script-fixture-v1')
})
it('recovers a marked folder after a crash during script creation', async () => {
  const f = folderFixture({ 'abele-test-script-fixture.txt': 'abele-script-fixture-v1' })
  await f.prepareScriptFixtureFolder('Sample', folderSources)
  expect(f.app.vault.delete).toHaveBeenCalledTimes(1)
})
it.each(['.backup/notes.md', '.notes.md'])(
  'preserves unindexed disk contents during setup and cleanup: %s',
  async (hidden) => {
    const f = folderFixture({
      ...folderSources,
      'abele-test-script-fixture.txt': 'abele-script-fixture-v1',
      [hidden]: 'Keep this',
    })
    await expect(f.prepareScriptFixtureFolder('Sample', folderSources)).rejects.toThrow('not owned')
    await expect(f.removeScriptFixtureFolder('Sample', folderSources)).rejects.toThrow('not owned')
    expect(f.app.vault.delete).not.toHaveBeenCalled()
    expect(f.contents.get(hidden)).toBe('Keep this')
  }
)
it.each([
  { 'notes.md': 'Keep this' },
  { ...folderSources, 'notes.md': 'Keep this' },
  { 'sample.js': 'return "changed"' },
  { 'abele-test-script-fixture.txt': 'abele-script-fixture-v1', 'notes.md': 'Keep this' },
  { 'abele-test-script-fixture.txt': 'different marker', ...folderSources },
  { 'sample.js': folderSources['sample.js'], 'nested/notes.md': 'Keep this' },
  {},
])('preserves unexpected existing contents during setup and cleanup: %j', async (files) => {
  const f = folderFixture(files)
  await expect(f.prepareScriptFixtureFolder('Sample', folderSources)).rejects.toThrow('not owned')
  await expect(f.removeScriptFixtureFolder('Sample', folderSources)).rejects.toThrow('not owned')
  expect(f.app.vault.delete).not.toHaveBeenCalled()
  expect(f.app.vault.createFolder).not.toHaveBeenCalled()
})
it('does not adopt an incomplete unmarked legacy folder', async () => {
  const f = folderFixture(folderSources)
  await expect(
    f.prepareScriptFixtureFolder('Sample', { ...folderSources, 'other.js': 'return "other"' })
  ).rejects.toThrow('not owned')
  expect(f.app.vault.delete).not.toHaveBeenCalled()
})
it('cleans up a marked folder and can set it up again when absent', async () => {
  const f = folderFixture({
    ...folderSources,
    'abele-test-script-fixture.txt': 'abele-script-fixture-v1',
  })
  await f.removeScriptFixtureFolder('Sample', folderSources)
  await f.removeScriptFixtureFolder('Sample', folderSources)
  expect(f.app.vault.delete).toHaveBeenCalledTimes(1)
  await f.prepareScriptFixtureFolder('Sample', folderSources)
  expect(f.app.vault.createFolder).toHaveBeenCalledTimes(1)
  expect(f.contents.get('abele-test-script-fixture.txt')).toBe('abele-script-fixture-v1')
})
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
it.each([null, retained])(
  'keeps the original connection baseline across repeated saves',
  async (registry) => {
    const f = fixture(registry, legacy)
    const first = await f.saveScriptFixture()
    const second = await f.saveScriptFixture()
    expect(second).toEqual(first)
    await f.restoreScriptFixture(second)
    expect(f.local.get(registryKey)).toEqual(registry)
    expect(f.local.get(legacyKey)).toEqual(legacy)
    const fresh = await f.saveScriptFixture()
    expect(fresh).toEqual(first)
    await f.restoreScriptFixture(fresh)
  }
)
it('does not overwrite changed connection state during a repeated save', async () => {
  const f = fixture()
  const saved = await f.saveScriptFixture()
  f.local.set(registryKey, retained)
  await expect(f.saveScriptFixture()).rejects.toThrow('disconnected context changed')
  expect(f.local.get(registryKey)).toEqual(retained)
  await f.restoreScriptFixture(saved)
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
