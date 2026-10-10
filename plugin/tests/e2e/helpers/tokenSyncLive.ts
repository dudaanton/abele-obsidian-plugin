import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sha256, V2EngineClient, AccessClient } from '@abele/sync-core'
import type { CommitOp, V2ManifestItem } from '@abele/sync-protocol'
import { vaultCli } from './obsidianCli'
import { SyncDriver } from './syncDriver'
import { spawnSyncServer, siblingMissing, fixtureFetch, type SyncServer } from './syncServer'
import { exposeToPhone, PHONE_VAULT } from './phone'
import { onPhone } from './target'
import { waitFor } from './syncVault'
import { syncFixtureRules } from './syncFixtureRules'
function cleanupReason(error: unknown, depth = 0): string {
  const message = error instanceof Error ? error.message : String(error)
  return error instanceof AggregateError && depth < 3
    ? message + ': ' + error.errors.map((one) => cleanupReason(one, depth + 1)).join('; ')
    : message
}
/** Manager leases both named pool vaults. Never open, register or dispose shared app windows. */
export class TokenSyncLive {
  readonly root = 'Sync fixtures ' + randomUUID().slice(0, 8)
  readonly primary: SyncDriver
  readonly peer?: SyncDriver
  readonly servers: SyncServer[] = []
  readonly ids = new Map<SyncDriver, string[]>()
  private readonly saved = new Map<SyncDriver, { ignore: string | null; file: string | null }>()
  private readonly reverses: (() => void)[] = []
  private work = ''
  private closing?: Promise<void>
  constructor(peer = true) {
    const name = onPhone() ? PHONE_VAULT : process.env.OBSIDIAN_TEST_VAULT
    if (!name) throw new Error('An exclusively leased primary pool vault is required')
    this.primary = new SyncDriver(() => vaultCli(name))
    if (peer && !onPhone()) {
      const other = process.env.ABELE_SYNC_PEER_VAULT
      if (!other || other === name)
        throw new Error('A different exclusively leased peer pool vault is required')
      this.peer = new SyncDriver(() => vaultCli(other))
    }
  }
  async start(): Promise<void> {
    siblingMissing()
    try {
      // Validate BOTH leases before mutating either one; never reset pre-existing state here.
      for (const [label, device] of [
        ['primary', this.primary],
        ...(this.peer ? [['peer', this.peer] as const] : []),
      ] as const) {
        const rows = device.rows(),
          candidates = device.candidates(),
          questions = device.questions()
        if (rows.length || candidates.length || questions.length)
          throw new Error(
            'Pool vault contains existing connections or pending reviews; untouched. ' +
              label +
              ': ' +
              JSON.stringify({
                connections: rows.map((one) => `${one.id} (${one.status}) ${one.address}`),
                candidates: candidates.map((one) => one.path),
                consents: questions.map((one) => one.path),
              })
          )
      }
      for (const device of [this.primary, ...(this.peer ? [this.peer] : [])]) {
        const saved = device.run<{ ignore: string | null; file: string | null }>(
          `return {ignore:await app.vault.adapter.exists('.abele-sync-ignore')?await app.vault.adapter.read('.abele-sync-ignore'):null,file:app.workspace.getActiveFile()?.path||null}`
        )
        this.saved.set(device, saved)
        if (!onPhone())
          device.run(
            `window.__abeleSyncVisibility = Object.fromEntries(['hidden','visibilityState'].map(key=>[key,Object.getOwnPropertyDescriptor(document,key)]));Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});document.dispatchEvent(new Event('visibilitychange'));return true`
          )
        // Configuration is excluded except in the explicit settings suite; do not exchange pool credentials.
        device.run(
          `await app.vault.adapter.write('.abele-sync-ignore',${JSON.stringify(syncFixtureRules(this.root))});return true`
        )
        this.ids.set(device, [])
      }
      this.work = mkdtempSync(join(tmpdir(), 'abele-token-live-'))
      await this.addServer()
    } catch (error) {
      await this.close()
      throw error
    }
  }
  async addServer(): Promise<SyncServer> {
    const dir = join(this.work, 'server-' + this.servers.length)
    mkdirSync(dir)
    const server = await spawnSyncServer(dir)
    this.servers.push(server)
    if (onPhone())
      this.reverses.push(
        exposeToPhone(new URL(server.url).port ? Number(new URL(server.url).port) : 80)
      )
    return server
  }
  get server(): SyncServer {
    return this.servers[0]
  }
  client(server = this.server): V2EngineClient {
    return new V2EngineClient(server.rootToken, { fetch: fixtureFetch })
  }
  async connect(device = this.primary, token = this.server.rootToken): Promise<string> {
    const client = AccessClient.fromToken(token, { fetch: fixtureFetch })
    await waitFor(
      'new group scope to become active',
      async () => {
        try {
          return (await client.connection()).status === 'active'
        } catch (error) {
          if ((error as { code?: string }).code === 'scope_updating') return false
          throw new Error('Fixture token is not available')
        }
      },
      60000
    ).catch((error) => {
      throw device.failure('fixture token readiness', error)
    })
    const before = new Set(device.rows().map((one) => one.id))
    let id: string
    try {
      id = await device.connect(token)
    } finally {
      // Even a failed activation can have saved a native connection. Own it for teardown.
      const owned = this.ids.get(device)!
      for (const row of device.rows())
        if (!before.has(row.id) && !owned.includes(row.id)) owned.push(row.id)
      device.captureTokenOwnership()
    }
    await device.syncNow(id)
    return id
  }
  async cycle(): Promise<void> {
    await this.primary.syncNow()
    if (this.peer) {
      await this.peer.syncNow()
      await this.primary.syncNow()
      await this.peer.syncNow()
    }
  }
  async items(server = this.server): Promise<V2ManifestItem[]> {
    const result: V2ManifestItem[] = []
    let cursor: string | null = null
    do {
      const page = await this.client(server).manifest(cursor)
      result.push(...page.items)
      cursor = page.next
    } while (cursor)
    return result
  }
  async put(path: string, text: string, server = this.server): Promise<void> {
    const bytes = new TextEncoder().encode(text),
      sha = await sha256(bytes),
      client = this.client(server),
      prior = (await this.items(server)).find((one) => one.path === path)
    await client.putBlob(sha, bytes)
    await this.commit(
      [
        prior
          ? {
              op: 'modify',
              file_id: prior.file_id,
              base_version_id: prior.version_id,
              sha,
              size: bytes.length,
              mtime: Date.now(),
            }
          : { op: 'create', path, sha, size: bytes.length, mtime: Date.now() },
      ],
      server
    )
  }
  async commit(ops: CommitOp[], server = this.server): Promise<void> {
    const result = await this.client(server).commitRaw(ops, randomUUID())
    if (result.body.results.some((one) => one.status === 'rejected'))
      throw new Error('Remote fixture commit was rejected')
  }
  close(): Promise<void> {
    return (this.closing ??= this.closeOwned())
  }
  private async closeOwned(): Promise<void> {
    const failures: unknown[] = []
    for (const device of this.saved.keys()) device.retire()
    for (const [device, saved] of [...this.saved].reverse()) {
      try {
        await device.resetTokenState()
      } catch (error) {
        try {
          await device.forceResetTokenState()
          console.warn(
            'Live sync polite cleanup failed; guarded pool reset succeeded:',
            cleanupReason(error)
          )
        } catch (fallback) {
          failures.push(
            new AggregateError(
              [error, fallback],
              'Polite cleanup and guarded pool reset both failed'
            )
          )
        }
      }
      try {
        // Fixture files are the only notes this case owns. Reset itself never touches files.
        device.remove([this.root], true)
      } catch (error) {
        failures.push(error)
      }
      try {
        device.run(
          `if(${JSON.stringify(saved.ignore)}===null){if(await app.vault.adapter.exists('.abele-sync-ignore'))await app.vault.adapter.remove('.abele-sync-ignore')}else await app.vault.adapter.write('.abele-sync-ignore',${JSON.stringify(saved.ignore)});const old=${JSON.stringify(saved.file)};if(old&&app.vault.getFileByPath(old))await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath(old));app.setting.close();return true`,
          true
        )
      } catch (error) {
        failures.push(error)
      } finally {
        try {
          if (!onPhone())
            device.run(
              `for(const key of ['hidden','visibilityState']){const prior=window.__abeleSyncVisibility?.[key];if(prior)Object.defineProperty(document,key,prior);else delete document[key]}delete window.__abeleSyncVisibility;document.dispatchEvent(new Event('visibilitychange'));return true`,
              true
            )
        } catch (error) {
          failures.push(error)
        }
      }
    }
    this.saved.clear()
    for (const reverse of this.reverses.splice(0)) {
      try {
        reverse()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const server of this.servers.splice(0))
      try {
        await server.kill()
      } catch (error) {
        failures.push(error)
      }
    if (this.work) rmSync(this.work, { recursive: true, force: true })
    if (failures.length)
      throw new AggregateError(
        failures,
        'Live sync fixture cleanup failed: ' + failures.map((one) => cleanupReason(one)).join('; ')
      )
  }
}
