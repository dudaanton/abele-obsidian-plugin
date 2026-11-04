import { afterEach, expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { RuntimeFence } from '@/sync/external/recovery'

afterEach(() => vi.restoreAllMocks())
const parent = '.obsidian/plugins/abele'
const path = parent + '/data.json'
const collect = async (fs: ObsidianFileSystem) => {
  const paths: string[] = []
  for await (const info of fs.list()) paths.push(info.path)
  return paths
}
const failure = (kind: string) =>
  kind === 'timeout'
    ? new Error('File system operation timed out.')
    : Object.assign(new Error('Sample listing failure'), { code: kind })

it.each(['timeout', 'ENOENT', 'ENOTDIR'])(
  'retries a transient %s listing without treating an existing config folder as empty',
  async (kind) => {
    const app = buildFakeVault([{ path, content: '{}' }])
    const original = app.vault.adapter.list.bind(app.vault.adapter)
    let attempts = 0
    vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (folder) => {
      if (folder === parent && ++attempts === 1) throw failure(kind)
      return original(folder)
    })
    app.workspace.layoutReady = true
    const fs = new ObsidianFileSystem(app as never, { prepareStartupInventory: async () => {} })
    expect(await collect(fs)).toContain(path)
    expect(attempts).toBe(2)
  }
)

it.each(['timeout', 'ENOENT', 'EACCES', 'EIO'])(
  'keeps a persistent %s failure visible rather than publishing an empty config inventory',
  async (kind) => {
    const app = buildFakeVault([{ path, content: '{}' }])
    const original = app.vault.adapter.list.bind(app.vault.adapter)
    let attempts = 0
    const error = failure(kind)
    vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (folder) => {
      if (folder === parent) {
        attempts++
        throw error
      }
      return original(folder)
    })
    app.workspace.layoutReady = true
    const fs = new ObsidianFileSystem(app as never, { prepareStartupInventory: async () => {} })
    await expect(collect(fs)).rejects.toMatchObject({
      message: `cannot list ${parent}`,
      cause: error,
    })
    expect(attempts).toBe(kind === 'timeout' || kind === 'ENOENT' ? 2 : 1)
  }
)

it('does not retry a listing after the connection loses ownership', async () => {
  const app = buildFakeVault([{ path, content: '{}' }])
  app.workspace.layoutReady = true
  let owned = true
  const values = new Map<string, unknown>()
  const fence = new RuntimeFence(
    {
      loadLocalStorage: (key) => values.get(key) ?? null,
      saveLocalStorage: (key, value) => {
        values.set(key, value)
      },
    },
    'sample-listing-owner',
    () => owned
  )
  fence.activate()
  const original = app.vault.adapter.list.bind(app.vault.adapter)
  let attempts = 0
  vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (folder) => {
    if (folder === parent) {
      attempts++
      owned = false
      throw failure('timeout')
    }
    return original(folder)
  })
  const fs = new ObsidianFileSystem(app as never, {
    runtimeFence: fence,
    prepareStartupInventory: async () => {},
  })
  try {
    await expect(collect(fs)).rejects.toThrow()
    expect(attempts).toBe(1)
  } finally {
    fence.release()
  }
})

it('treats a config folder that really vanished as absent without retrying', async () => {
  const app = buildFakeVault([{ path, content: '{}' }])
  app.workspace.layoutReady = true
  const original = app.vault.adapter.list.bind(app.vault.adapter)
  let attempts = 0
  let vanished = false
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  const exists = app.vault.adapter.exists.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (folder) =>
    vanished && folder === parent ? null : stat(folder)
  )
  vi.spyOn(app.vault.adapter, 'exists').mockImplementation(async (folder) =>
    vanished && folder === parent ? false : exists(folder)
  )
  vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (folder) => {
    if (folder === parent) {
      attempts++
      vanished = true
      throw failure('ENOENT')
    }
    return original(folder)
  })
  const fs = new ObsidianFileSystem(app as never, { prepareStartupInventory: async () => {} })
  expect(await collect(fs)).not.toContain(path)
  expect(attempts).toBe(1)
})
