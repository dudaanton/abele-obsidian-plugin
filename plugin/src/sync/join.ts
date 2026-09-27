import type { App } from 'obsidian'
import { isExcluded, SyncClient, type SelectiveSettings } from '@abele/sync-core'
import {
  kindOf,
  normalisePath,
  serverUrlProblem,
  validatePath,
  type Usage,
  type VaultInfo,
} from '@abele/sync-protocol'
import type { DeviceConnection } from './connection'
import { IndexedDbStateStore, stateDatabaseName } from './IndexedDbStateStore'
import { readLedgerId } from './ledgerId'
import { messageOf } from './messages'
import { ObsidianFileSystem } from './ObsidianFileSystem'
import { withTimeout } from './revoke'
import { DEFAULT_SCRIPTS_FOLDER, ignoreFor, readIgnore } from './scope'
import { USER_AGENT } from './transport'

/**
 * What the join dialog is told before it asks anything (phase 3b, decision 7).
 *
 * A device joining a vault that already has files, from a vault that has files too, has to be
 * told which side wins where both hold a file at one path with other bytes — guessing is
 * guessing whose copy becomes the head everywhere. So the question depends on three facts, and
 * this module finds them: how many files this vault would sync, how many live files the server
 * holds, and whether this vault already walked that server's files to the end once. None of it
 * asks the server anything but the count, and nothing here enrols or writes.
 */

/** How many files one side holds; `settings` is how many of them are Obsidian's settings. */
export interface FileCount {
  files: number
  settings: number
}

/**
 * Which question a join asks:
 * - `choose`: both sides hold files — which side wins where both have one;
 * - `upload`: only this vault holds files, and they go up;
 * - `download`: only the server holds files, and they come down;
 * - `empty`: neither holds anything;
 * - `reconnect`: this vault already walked the server's files to the end once, and picks up
 *   where it left off — nothing to decide.
 */
export type JoinKind = 'choose' | 'upload' | 'download' | 'empty' | 'reconnect'

/** Everything the join dialog shows. */
export interface JoinQuestion {
  kind: JoinKind
  /** What the vault is called on the server, or its id when nobody said. */
  vaultName: string
  here: FileCount
  /** Null when the server could not be asked; the question is then asked as if it held files. */
  there: FileCount | null
}

/** The question the three facts ask. A server that could not be counted may hold anything. */
export function joinKind(here: FileCount, there: FileCount | null, kept: boolean): JoinKind {
  if (kept) return 'reconnect'
  const remote = there === null || there.files > 0
  if (here.files > 0) return remote ? 'choose' : 'upload'
  if (there === null) return 'download'
  return remote ? 'download' : 'empty'
}

/** The server's live files, of every kind, from the usage the vault list or its state carries. */
export function countThere(usage: Pick<Usage, 'by_kind'>): FileCount {
  let files = 0
  for (const kind of Object.values(usage.by_kind)) files += kind?.count ?? 0
  return { files, settings: usage.by_kind.settings?.count ?? 0 }
}

/**
 * How many files in this vault the engine would sync: what it lists, less what the hidden rule,
 * the ignore file and this device's selective settings pass over — the filter the engine scans
 * with, asked of the same listing. Nothing is read or hashed; an ignore file that is there and
 * will not read throws, as it stops the engine too. `keptOut` is the file the join leaves alone
 * (this device's own `data.json`), not counted since it is not joined.
 */
export async function countHere(
  app: App,
  selective: SelectiveSettings,
  scriptsFolder: string,
  keptOut: string | null = null
): Promise<FileCount> {
  const ignore = ignoreFor(app.vault.configDir, await readIgnore(app), keptOut)
  const count: FileCount = { files: 0, settings: 0 }
  for await (const info of new ObsidianFileSystem(app).list()) {
    let wire: string
    try {
      wire = normalisePath(info.path)
      validatePath(wire)
    } catch {
      continue
    }
    if (ignore.ignores(wire) || isExcluded(wire, info.size, selective, scriptsFolder)) continue
    count.files++
    if (kindOf(wire, scriptsFolder) === 'settings') count.settings++
  }
  return count
}

/**
 * Whether this vault already walked the server's files of `vaultId` to the end once: its ledger
 * is for that vault, and its cursor is past the start of the feed. A ledger still at 0 is a join
 * that never got through its first sync, and is asked again rather than taken as a reconnect.
 */
export async function keptLedger(app: App, factory: IDBFactory, vaultId: string): Promise<boolean> {
  const ledger = readLedgerId(app)
  if (ledger.stateId === '' || ledger.vaultId !== vaultId) return false
  const store = await IndexedDbStateStore.open(factory, stateDatabaseName(ledger.stateId))
  try {
    return (await store.getCursor()) > 0
  } finally {
    store.close()
  }
}

/** What `askJoin` is handed by the service. */
export interface JoinFacts {
  app: App
  factory: IDBFactory
  /** This device's connection: what it syncs, and the vault a transfer left the question on. */
  connection: DeviceConnection
  /** The device token, or null; asked only for a vault this device is connected to. */
  token: string | null
  transport: typeof fetch
  /** How long the server is given to say how many files it holds. */
  timeoutMs: number
  /** The scripts folder the engine is built with; empty for the engine's own default. */
  scriptsFolder: string
  /** This device's own `data.json`, which a join leaves alone (`EngineRunner.build`). */
  ownSettings: string
  note(text: string): void
  /** The vault a sign-in listed, or undefined for the one this device is connected to. */
  vault?: VaultInfo
}

/**
 * The question a join asks. Of a vault a sign-in listed, the server's count is the one the
 * listing carries; of the vault a transfer connected this device to, it is asked on the device's
 * own token — and a server that does not answer is counted as unknown, which asks the question
 * rather than skipping it. Nothing is enrolled or written.
 */
export async function askJoin(facts: JoinFacts): Promise<JoinQuestion> {
  const { app, connection, vault } = facts
  const vaultId = vault?.id ?? connection.vaultId
  if (vaultId === '') throw new Error('there is no vault to join')
  const there = vault === undefined ? await countOnServer(facts) : countThere(vault.usage)
  const scriptsFolder = facts.scriptsFolder || DEFAULT_SCRIPTS_FOLDER
  const here = await countHere(app, connection.selective, scriptsFolder, facts.ownSettings)
  const kept = await keptLedger(app, facts.factory, vaultId)
  return {
    kind: joinKind(here, there, kept),
    vaultName: vault?.name || connection.vaultName || vaultId,
    here,
    there,
  }
}

/** The live files of the vault this device is connected to, or null when they cannot be asked. */
async function countOnServer(facts: JoinFacts): Promise<FileCount | null> {
  const { connection, token } = facts
  if (token === null || serverUrlProblem(connection.serverUrl) !== null) return null
  try {
    const client = new SyncClient({
      baseUrl: connection.serverUrl,
      fetch: facts.transport,
      token,
      userAgent: USER_AGENT,
    }).forVault(connection.vaultId)
    return countThere((await withTimeout(client.state(), facts.timeoutMs)).usage)
  } catch (error) {
    facts.note(`the server's files could not be counted: ${messageOf(error)}`)
    return null
  }
}
