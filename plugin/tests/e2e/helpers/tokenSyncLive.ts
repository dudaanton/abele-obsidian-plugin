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
      for (const device of [this.primary, ...(this.peer ? [this.peer] : [])]) {
        if (device.rows().length || device.candidates().length || device.questions().length)
          throw new Error('Pool vault contains existing connections or pending reviews; untouched')
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
          `await app.vault.adapter.write('.abele-sync-ignore',${JSON.stringify('*\n!' + this.root + '/\n!' + this.root + '/**\n.obsidian/\n')});return true`
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
    )
    const before = new Set(device.rows().map((one) => one.id))
    let id: string
    try {
      id = await device.connect(token)
    } finally {
      // Even a failed activation can have saved a native connection. Own it for teardown.
      const owned = this.ids.get(device)!
      for (const row of device.rows())
        if (!before.has(row.id) && !owned.includes(row.id)) owned.push(row.id)
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
  async close(): Promise<void> {
    const failures: unknown[] = []
    for (const [device, saved] of [...this.saved].reverse()) {
      try {
        for (const candidate of device.candidates())
          if ((this.ids.get(device) || []).includes(candidate.source.id))
            device.run(
              `await svc.reject(svc.candidates.value.find(one=>one.id===${JSON.stringify(candidate.id)}));return true`
            )
        device.run(
          `for(const question of svc.questions.value.filter(one=>${JSON.stringify(this.ids.get(device) || [])}.includes(one.source.id)))await svc.decide(question,false);return true`
        )
        for (const id of this.ids.get(device) || [])
          if (device.rows().some((one) => one.id === id)) await device.disconnect(id)
        device.remove([this.root])
        device.run(
          `if(${JSON.stringify(saved.ignore)}===null){if(await app.vault.adapter.exists('.abele-sync-ignore'))await app.vault.adapter.remove('.abele-sync-ignore')}else await app.vault.adapter.write('.abele-sync-ignore',${JSON.stringify(saved.ignore)});const old=${JSON.stringify(saved.file)};if(old&&app.vault.getFileByPath(old))await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath(old));app.setting.close();return true`
        )
      } catch (error) {
        failures.push(error)
      } finally {
        try {
          if (!onPhone())
            device.run(
              `for(const key of ['hidden','visibilityState']){const prior=window.__abeleSyncVisibility?.[key];if(prior)Object.defineProperty(document,key,prior);else delete document[key]}delete window.__abeleSyncVisibility;document.dispatchEvent(new Event('visibilitychange'));return true`
            )
        } catch (error) {
          failures.push(error)
        }
      }
    }
    this.saved.clear()
    for (const reverse of this.reverses.splice(0)) reverse()
    for (const server of this.servers.splice(0))
      try {
        await server.kill()
      } catch (error) {
        failures.push(error)
      }
    if (this.work) rmSync(this.work, { recursive: true, force: true })
    if (failures.length) throw new AggregateError(failures, 'Live sync fixture cleanup failed')
  }
}
