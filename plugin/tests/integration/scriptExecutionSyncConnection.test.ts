import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { ConnectionRegistry } from '@/sync/connectionRegistry'
import { storageOf } from '@/sync/vaultWrites'
import { hasScriptConnection } from '@/scripting/trust/scriptConnection'
import { scriptForExecution } from '@/scripting/trust/scriptExecutionGate'
import { SCRIPT_SENTINEL } from '@/scripting/trust/scriptTrustStorage'

const path = 'Scripts/local-sample.js'
const mine = 'Scripts/my.js'
const synced = 'Agents Test/synced.js'
const token = {
  v: 1 as const,
  address: 'https://sync.example',
  key: 'a'.repeat(43),
  scope: { kind: 'folder' as const, id: 'root', path: '/' },
}
const authority = {
  protocol: 2 as const,
  token_id: 'sample',
  space_id: 'sample',
  scope: token.scope,
  status: 'active' as const,
}
const keys = new Map<string, string>()
const secretPort = {
  get: (id: string) => keys.get(id) ?? null,
  set: (id: string, key: string) => {
    keys.set(id, key)
  },
}

let app: App
function connect(address = token.address, folder?: string) {
  const registry = ConnectionRegistry.open(storageOf(app)!)
  const id = registry.add()
  const scope = folder ? { kind: 'folder' as const, id: 'folder', path: folder } : token.scope
  registry.attach(id, { ...token, address, scope }, { ...authority, scope }, secretPort)
  return { registry, id }
}
const marker = () =>
  app.vault.adapter.writeBinary(
    SCRIPT_SENTINEL,
    new TextEncoder().encode('Managed script provenance required\n').buffer as ArrayBuffer
  )

beforeEach(() => {
  app = useVault([
    { path, content: '// @name Local sample\nreturn "local"' },
    { path: mine, content: '// @name Mine\nreturn "mine"' },
    { path: synced, content: '// @name Synced\nreturn "synced"' },
  ]) as unknown as App
})
afterEach(() => vi.restoreAllMocks())

describe('a local script in a vault with a sync connection', () => {
  it('runs from an automation (no confirmation) exactly as without the connection', async () => {
    connect()
    expect(hasScriptConnection(storageOf(app))).toBe(true)
    const script = await scriptForExecution(app, path)
    expect(script.meta.name).toBe('Local sample')
    expect(script.code).toContain('return "local"')
  })

  it('runs from a button that could ask for confirmation, without asking', async () => {
    connect()
    const confirm = vi.fn(async () => true)
    const script = await scriptForExecution(app, path, confirm)
    expect(script.meta.name).toBe('Local sample')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('still refuses when the selected connection changes during the check', async () => {
    const { registry, id } = connect()
    const other = registry.add()
    registry.attach(other, { ...token, address: 'https://other.example' }, authority, secretPort)
    registry.select(id)
    const original = app.vault.adapter.readBinary.bind(app.vault.adapter)
    let reads = 0
    vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (file: string) => {
      if (++reads === 2) ConnectionRegistry.open(storageOf(app)!).select(other)
      return original(file)
    })
    await expect(scriptForExecution(app, path)).rejects.toThrow(
      'Script connection changed during the execution check'
    )
  })

  it('still refuses when a connection appears during the check', async () => {
    const original = app.vault.adapter.readBinary.bind(app.vault.adapter)
    let reads = 0
    vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (file: string) => {
      if (++reads === 2) connect()
      return original(file)
    })
    await expect(scriptForExecution(app, path)).rejects.toThrow(
      'Script connection changed during the execution check'
    )
  })
})

describe('a script outside every connection folder', () => {
  it('runs from an automation while a folder connection to "Agents Test" exists', async () => {
    connect(token.address, 'Agents Test')
    expect(hasScriptConnection(storageOf(app))).toBe(true)
    expect((await scriptForExecution(app, mine)).meta.name).toBe('Mine')
  })

  it('ignores sync provenance markers that only govern synced folders', async () => {
    connect(token.address, 'Agents Test')
    await marker()
    const confirm = vi.fn(async () => true)
    expect((await scriptForExecution(app, mine)).meta.name).toBe('Mine')
    expect((await scriptForExecution(app, mine, confirm)).meta.name).toBe('Mine')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('keeps the current rules for a script inside "Agents Test/"', async () => {
    connect(token.address, 'Agents Test')
    await marker()
    await expect(scriptForExecution(app, synced)).rejects.toThrow(/provenance is missing/i)
  })

  it('treats "agents test" in another case as the same folder', async () => {
    connect(token.address, 'agents test')
    await marker()
    await expect(scriptForExecution(app, synced)).rejects.toThrow(/provenance is missing/i)
  })

  it('keeps the current rules when a whole-vault connection exists beside the folder one', async () => {
    connect(token.address, 'Agents Test')
    connect('https://other.example')
    await marker()
    await expect(scriptForExecution(app, mine)).rejects.toThrow(/provenance is missing/i)
  })

  it('refuses when a connection to its folder appears during the check', async () => {
    connect(token.address, 'Agents Test')
    const original = app.vault.adapter.readBinary.bind(app.vault.adapter)
    let reads = 0
    vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (file: string) => {
      if (++reads === 2) connect('https://other.example', 'Scripts')
      return original(file)
    })
    await expect(scriptForExecution(app, mine)).rejects.toThrow(
      'Script connection changed during the execution check'
    )
  })
})
