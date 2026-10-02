import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { vaultCli, type VaultCli } from './helpers/obsidianCli'
import { spawnSyncServer, initDaemon, daemonSyncOnce, type SyncServer } from './helpers/syncServer'
import { waitFor } from './helpers/syncVault'

/** Task 14 desktop/daemon supplement. Explicitly NOT a native three-device pass. */
let cli: VaultCli,
  server: SyncServer,
  work = '',
  daemon = '',
  root = ''
let owned = false,
  paired = false,
  savedIgnore: string | null = null
let savedState: Record<string, unknown> = {},
  savedMarker: number[] | null = null
const localKeys = [
  'abele-sync-connection',
  'abele-sync-ledger',
  'abele-sync-ledger-proof',
  'abele-sync-ledger-bootstrap',
  'abele-script-provenance',
]
const service = 'window.__abeleTest.SyncService.getInstance()'
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const text = (path: string) =>
  cli.evalAwait<string>(`app.vault.adapter.read(${JSON.stringify(root + '/' + path)})`)
async function settle() {
  await waitFor(
    'native personal fixture to settle',
    () => {
      const status = cli.evalAwait<any>(`${service}.status.value`)
      if (status.state === 'error' || status.state === 'offline') throw new Error(status.lastError)
      return status.state === 'idle' && status.pending === 0
    },
    30_000
  )
}
async function cycle() {
  daemonSyncOnce(daemon)
  cli.evalAwait(`${service}.syncNow().then(() => true)`)
  await settle()
  daemonSyncOnce(daemon)
}

beforeAll(async () => {
  const name = process.env.OBSIDIAN_TEST_VAULT
  if (!name) throw new Error('Personal baseline requires an exclusively leased pool vault')
  cli = vaultCli(name)
  if (cli.evalAwait<boolean>(`!!${service}.connection.value.vaultId`))
    throw new Error(
      'Baseline requires an unconfigured leased fixture; existing connection left untouched'
    )
  savedState = cli.evalAwait(
    `Object.fromEntries(${JSON.stringify(localKeys)}.map(key => [key, app.loadLocalStorage(key)]))`
  )
  savedMarker = cli.evalAwait(
    `(async () => await app.vault.adapter.exists('.abele-script-managed') ? [...new Uint8Array(await app.vault.adapter.readBinary('.abele-script-managed'))] : null)()`
  )
  const scratch = fileURLToPath(new URL('../../../.scratch/batch5/personal/', import.meta.url))
  mkdirSync(scratch, { recursive: true })
  work = mkdtempSync(join(scratch, 'sample-'))
  daemon = join(work, 'daemon')
  mkdirSync(daemon)
  root = 'PersonalBaseline-' + randomBytes(12).toString('hex')
  savedIgnore = cli.evalAwait<string | null>(
    `(async () => app.vault.adapter.exists('.abele-sync-ignore').then(async yes => yes ? app.vault.adapter.read('.abele-sync-ignore') : null))()`
  )
  cli.evalAwait(
    `(async () => { await app.vault.createFolder(${JSON.stringify(root)}); return true })()`
  )
  owned = true
  cli.evalAwait(
    `app.vault.adapter.write('.abele-sync-ignore', ${JSON.stringify('*\n!' + root + '/\n!' + root + '/**\n')}).then(() => true)`
  )
  server = await spawnSyncServer(work)
  server.createAccount('personal-sample@example.com', 'sample-password-for-disposable-server')
  initDaemon({
    dir: daemon,
    serverUrl: server.url,
    email: 'personal-sample@example.com',
    password: 'sample-password-for-disposable-server',
    vaultName: 'SamplePersonal',
    deviceName: 'sample-daemon',
  })
  paired = true // Own any partial enrollment too, including a lost CLI acknowledgment.
  cli.evalAwait(
    `(async () => { const svc = ${service}; const vaults = await svc.connect(${JSON.stringify(server.url)}, 'personal-sample@example.com', 'sample-password-for-disposable-server'); await svc.chooseVault(vaults[0].id, 'sample-desktop'); return true })()`
  )
  paired = true
  await settle()
})
afterAll(async () => {
  const errors: unknown[] = []
  const cleanup = async (work: () => unknown | Promise<unknown>) => {
    try {
      await work()
    } catch (error) {
      errors.push(error)
    }
  }
  if (paired) {
    await cleanup(() => cli.evalAwait(`${service}.forget().then(() => true)`))
    paired = false
  }
  if (owned)
    await cleanup(() =>
      cli.evalAwait(`(async () => {
    const created = app.loadLocalStorage('abele-script-provenance')
    for (const [key, value] of Object.entries(${JSON.stringify(savedState)})) app.saveLocalStorage(key, value)
    const marker = ${JSON.stringify(savedMarker)}
    if (marker) await app.vault.adapter.writeBinary('.abele-script-managed', new Uint8Array(marker).buffer)
    else if (await app.vault.adapter.exists('.abele-script-managed')) await app.vault.adapter.remove('.abele-script-managed')
    if (!${JSON.stringify(!!savedState['abele-script-provenance'])} && created?.id) await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('abele-script-provenance-' + created.id)
      request.onsuccess = resolve; request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Baseline provenance DB remained open'))
    })
    return true
  })()`)
    )
  if (owned)
    await cleanup(() =>
      cli.evalAwait(
        `(async () => { const folder = app.vault.getAbstractFileByPath(${JSON.stringify(root)}); if (folder) await app.vault.delete(folder, true); return true })()`
      )
    )
  if (cli && owned)
    await cleanup(() =>
      cli.evalAwait(
        savedIgnore === null
          ? `app.vault.adapter.remove('.abele-sync-ignore').then(() => true)`
          : `app.vault.adapter.write('.abele-sync-ignore', ${JSON.stringify(savedIgnore)}).then(() => true)`
      )
    )
  if (server) await cleanup(() => server.kill())
  if (work) await cleanup(() => rmSync(work, { recursive: true, force: true }))
  if (errors.length) throw new AggregateError(errors, 'Personal baseline cleanup incomplete')
})

describe('personal desktop/daemon baseline supplement', () => {
  it('converges create, binary, rename and delete at exact paths', async () => {
    cli.evalAwait(
      String.raw`(async () => { await app.vault.create(${JSON.stringify(root + '/sample.md')}, 'one\ntwo\nthree\n'); await app.vault.createBinary(${JSON.stringify(root + '/sample.bin')}, new Uint8Array([1, 2, 3, 4]).buffer); return true })()`
    )
    cli.evalAwait(`${service}.syncNow().then(() => true)`)
    await settle()
    daemonSyncOnce(daemon)
    expect(readFileSync(join(daemon, root, 'sample.md'), 'utf8')).toBe('one\ntwo\nthree\n')
    expect([...readFileSync(join(daemon, root, 'sample.bin'))]).toEqual([1, 2, 3, 4])
    writeFileSync(join(daemon, root, 'remote.md'), 'from daemon')
    await cycle()
    expect(text('remote.md')).toBe('from daemon')
    cli.evalAwait(
      `(async () => { const file = app.vault.getAbstractFileByPath(${JSON.stringify(root + '/remote.md')}); await app.vault.rename(file, ${JSON.stringify(root + '/renamed.md')}); return true })()`
    )
    await cycle()
    expect(readFileSync(join(daemon, root, 'renamed.md'), 'utf8')).toBe('from daemon')
    cli.evalAwait(
      `app.vault.delete(app.vault.getAbstractFileByPath(${JSON.stringify(root + '/renamed.md')}), true).then(() => true)`
    )
    await cycle()
    expect(
      cli.evalAwait<boolean>(`app.vault.adapter.exists(${JSON.stringify(root + '/renamed.md')})`)
    ).toBe(false)
  })
  it('retains offline concurrent edits with the personal in-place merge', async () => {
    cli.evalAwait(
      String.raw`(async () => { ${service}.pause(); await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(root + '/sample.md')}), 'desktop\ntwo\nthree\n'); return true })()`
    )
    writeFileSync(join(daemon, root, 'sample.md'), 'one\ntwo\ndaemon\n')
    daemonSyncOnce(daemon)
    cli.evalAwait(`(() => { ${service}.resume(); return true })()`)
    await settle()
    await cycle()
    const merged = text('sample.md')
    expect(merged).toContain('desktop')
    expect(merged).toContain('daemon')
    expect(readFileSync(join(daemon, root, 'sample.md'), 'utf8')).toBe(merged)
  })
  it('replays a committed response lost before settlement across a plugin restart', async () => {
    cli.evalAwait(`(() => {
      const svc = ${service}; svc.pause()
      const client = svc.client(), commit = client.commitRaw.bind(client)
      client.commitRaw = async (ops, key) => {
        await commit(ops, key)
        // Keep the old runtime's receipt unacknowledged even if a backoff trigger retries.
        throw new Error('Synthetic committed response was lost')
      }
      return true
    })()`)
    cli.evalAwait(
      `app.vault.create(${JSON.stringify(root + '/lost-response.md')}, 'Committed once').then(() => true)`
    )
    cli.evalAwait(`(() => { ${service}.resume(); return true })()`)
    await waitFor(
      'the committed response to be lost',
      () => {
        const status = cli.evalAwait<any>(`${service}.status.value`)
        return status.state === 'error' || status.state === 'offline'
      },
      30_000
    )
    // A read-only state query does not settle/replay the lost commit journal.
    const before = cli.evalAwait<any>(`${service}.client().state()`)
    daemonSyncOnce(daemon)
    cli.run(['plugin:reload', 'id=abele'])
    await waitFor(
      'the checked development plugin to return',
      () => {
        try {
          return cli.evalAwait<boolean>('!!window.__abeleTest')
        } catch {
          return false
        }
      },
      30_000
    )
    await settle()
    await cycle()
    const after = cli.evalAwait<any>(`${service}.client().state()`)
    expect(after.head_seq).toBe(before.head_seq)
    expect(text('lost-response.md')).toBe('Committed once')
    expect(readFileSync(join(daemon, root, 'lost-response.md'), 'utf8')).toBe('Committed once')
  })

  it('has matching hashes and produces no versions during quiet cycles', async () => {
    const before = cli.evalAwait<any>(`${service}.client().state()`)
    await cycle()
    await cycle()
    const after = cli.evalAwait<any>(`${service}.client().state()`)
    expect(after.head_seq).toBe(before.head_seq)
    const native = cli.evalAwait<number[]>(
      `app.vault.adapter.readBinary(${JSON.stringify(root + '/sample.md')}).then(buffer => [...new Uint8Array(buffer)])`
    )
    expect(sha(Buffer.from(native))).toBe(sha(readFileSync(join(daemon, root, 'sample.md'))))
  })
})
