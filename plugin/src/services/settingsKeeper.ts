import { Notice } from 'obsidian'
import { SettingsEdits, settingsSnapshot } from './settingsEdits'
import { pruneToolDescriptions } from '@/ai/tools/toolDescriptionOverrides'
import type { AiChatHistoryEntry } from '@/ai/types'
import type AbelePlugin from '@/main'
import { isStoreFile } from '@/secrets/storeFile'
import type { ChatIndexKeeper } from './chatIndexKeeper'
import type { AbeleSettings } from './settingsShape'
import {
  canonicalJson,
  isSettingsObject,
  localChanges,
  pause,
  reapply,
  settingsStampOf,
  UNREADABLE_RETRY_MS,
} from './settingsFile'

/** What `SettingsKeeper` needs of the settings it reads and writes: `AbeleConfig`. */
export interface SettingsHost {
  edits(): SettingsEdits
  fresh(fresh: boolean): void
  plugin(): AbelePlugin | null
  /** Puts settings read off disk in force; answers whether a migration rewrote anything. */
  apply(
    settings: AbeleSettings | undefined,
    toolDefaults: Record<string, string>,
    index: AiChatHistoryEntry[]
  ): boolean
  /** The settings in memory as the file holds them. */
  export(): AbeleSettings
  secretStore(): unknown
  chatHistory(): AiChatHistoryEntry[]
  readonly index: ChatIndexKeeper
  /** The settings in memory were replaced by a reload: redraw, and tell the listeners. */
  reloaded(): void
  /**
   * A save took in a file that arrived before anything announced it (`catchUp`): the rest of a
   * reload — the secret store, the AI features — is still to be done.
   */
  arrivedUnannounced(): void
}

/**
 * The plugin's `data.json` as `AbeleConfig` reads and writes it: every load, reload and write,
 * one at a time, and what makes a synced settings file settle — a write only when the settings
 * changed in meaning, a file that arrived taken in before anything is written over it, and a
 * file that will not read never written over.
 */
export class SettingsKeeper {
  /**
   * Set when `data.json` exists but could not be read. Nothing is written until it reads
   * again: at startup what is in memory then is defaults, and saving them would replace every
   * setting the file still holds with nothing; on a reload what is in memory is the last good
   * copy, and writing it would bury whatever the broken file was on its way to saying.
   */
  private unreadable = false
  /** Said once per failed load: saves come from chats as well, and each would repeat it. */
  private unreadableTold = false
  /**
   * Whether what is in memory is defaults rather than anybody's settings: the startup load
   * found a file it could not read. The readable file that ends it is then taken as it is. After
   * a reload that could not read, memory is the last good copy instead, and a readable file is
   * taken the way any arriving one is (`ontoArrived`) — this device's key store kept, and what
   * was changed here meanwhile put back on top.
   */
  private defaultsInMemory = false
  /**
   * A pull removed the file and nothing has written it since. The next save writes it again;
   * so does the plugin unloading first (`leaving`), since the launch after would find no file,
   * start from defaults, and hand those to every device.
   */
  private gone = false

  /**
   * The `sync` block exactly as the startup load read it off disk, before the migration dropped
   * what is no longer a setting — or null when there was no file to read it from: none at all,
   * or one that would not parse. Kept for one reader: the one-time move of this device's
   * connection out of `data.json` (`SyncService.openConnection`), which takes it.
   *
   * Null and a file that named nothing are different things. A file that is missing for now — an
   * iCloud vault on a phone not yet downloaded — or half-written may still hold the connection,
   * and the move must wait for a launch that reads it rather than record that there was nothing.
   */
  private loadedSync: { sync: unknown } | null = null
  /** Settings writes wait until openConnection confirms durable local storage. */
  private pendingLegacySync: unknown = null
  private waitingForInitialFile = false
  private deferredRewrite = false

  /**
   * The settings file as this copy last read or wrote it, as canonical JSON (`settingsFile.ts`),
   * or null while it knows of no readable file.
   *
   * `data.json` syncs, and the later save wins, so two devices that each wrote the file back on
   * reading the other's would pass it between them for ever. This is what stops them: a save
   * that says what the file already says writes nothing, and a reload of the file this copy
   * already holds is no reload — which also makes the second of the two reloads one pulled file
   * gets (the sync's and Obsidian's own, see `reloadSettings`) do nothing.
   */
  private onDisk: string | null = null

  /**
   * The settings in memory as they were right after they were last read or written — their
   * export then. What differs from it now is what this copy changed since, and that is what a
   * save or a reload puts back on top of a file that arrived in between (`localChanges`).
   */
  private base: AbeleSettings | null = null
  /** Last applied/captured screen state, independent of a write still waiting on IO. */
  private saveCapture: AbeleSettings | null = null

  /**
   * The settings file's size and mtime when it was last read or written, or null for none (or
   * no disk to ask). A save that finds another reads the file again first: see `catchUp`.
   */
  private stamp: string | null = null

  /**
   * A save took in a file that arrived before its reload came, so the reload will find the file
   * read already. It must still answer that it reloaded, once: the secret store and the AI
   * features have not seen the new settings yet.
   */
  private unannounced = false

  /**
   * Apply and write effects are serialized. Reload reads deliberately run outside this queue:
   * a slow native read must not block a screen's save. SettingsEdits retains acknowledged
   * field patches until every read that could return an older snapshot has been reconciled.
   */
  private fileQueue: Promise<unknown> = Promise.resolve()
  /** Managed values are atomic: an older read cannot undo a successful local save. */
  private writeGeneration = 0

  constructor(private readonly host: SettingsHost) {}

  /** A new launch: nothing is known of the file yet. */
  reset(): void {
    this.gone = false
    this.onDisk = null
    this.base = null
    this.saveCapture = null
    this.stamp = null
    this.unannounced = false
  }

  /** Whether the settings file exists and could not be read: see `unreadable`. */
  get isUnreadable(): boolean {
    return this.unreadable
  }

  /** The startup load: read the file, and put what it says in force. */
  load(): Promise<void> {
    return this.onFile(() => this.loadNow())
  }

  private async loadNow(): Promise<void> {
    if (!this.host.plugin()) return
    // `null` is no file at all — a fresh install. `undefined` is a file Obsidian could not
    // parse, and that is still somebody's settings.
    const finishRead = this.host.edits().beginRead()
    try {
      const stamp = await this.readStamp()
      const stored: unknown = await this.host.plugin().loadData()
      this.deferredRewrite = false
      this.waitingForInitialFile = stored === null || stored === undefined
      const legacy = isSettingsObject(stored) && isSettingsObject(stored.sync) ? stored.sync : null
      this.pendingLegacySync =
        legacy && (legacy.serverUrl || legacy.deviceTokenId || legacy.vaultId)
          ? JSON.parse(JSON.stringify(legacy))
          : null
      const index = await this.host.index.read(this.host.plugin())
      this.host.index.onDisk = index !== null
      await this.take(stored, stored, () => index ?? [], stamp)
    } finally {
      finishRead()
    }
  }

  /** Runs `step` after every load, reload and write of the settings file already asked for. */
  private onFile<T>(step: () => Promise<T>): Promise<T> {
    const run = this.fileQueue.then(step)
    this.fileQueue = run.catch((): void => undefined)
    return run
  }

  /** The settings file's stamp now: see `stamp`. */
  private readStamp(plugin: AbelePlugin | null = this.host.plugin()): Promise<string | null> {
    return settingsStampOf(plugin)()
  }

  /**
   * Put what was read off disk in force: the half of a load after the read. `file` is what the
   * disk holds and `settings` what is applied — the same, unless changes made in memory are put
   * back on top of it. `index` answers with the chat index this copy holds — the index file's at
   * startup, the one in memory on a reload — which a settings file never replaces, only adds
   * to. Asked for after the wait below, so a chat listed during it is not dropped.
   */
  private async take(
    file: unknown,
    settings: unknown,
    index: () => AiChatHistoryEntry[],
    stamp: string | null
  ): Promise<void> {
    this.loadedSync =
      file === null || file === undefined ? null : { sync: (file as { sync?: unknown }).sync }
    this.host.fresh(file === null)
    this.unreadable = file === undefined
    this.defaultsInMemory = this.unreadable
    this.gone = false
    this.unreadableTold = false
    if (this.unreadable) console.error('[Abele] data.json could not be read; not writing to it')
    this.onDisk = isSettingsObject(file) ? canonicalJson(file) : null
    this.stamp = stamp

    const candidates = pruneToolDescriptions(
      (settings as AbeleSettings)?.ai?.prompts?.toolDescriptions
    ).kept
    const tools = Object.keys(candidates).length ? await codeToolDescriptions() : {}
    const migrated = this.host.apply(
      (settings ?? undefined) as AbeleSettings | undefined,
      tools,
      index()
    )
    this.base = this.host.export()
    const inSettings = this.host.index.inSettings
    const merged = this.host.edits().apply(this.base)
    if (canonicalJson(merged) !== canonicalJson(this.base))
      this.host.apply(merged, tools, this.host.chatHistory())
    this.host.index.inSettings = inSettings
    this.saveCapture = this.host.export()

    // The index goes to its own file before `data.json` is written without it: in the other
    // order, a crash between the two writes would lose every chat the index listed.
    if (this.host.index.inSettings || !this.host.index.onDisk) {
      await this.host.index.toFile(
        () => this.host.plugin(),
        () => this.host.chatHistory()
      )
    }

    // Migration only rewrites the settings held in memory. Persisting it here is what stops
    // the same migration running again on the next launch — and, for the Comment agent,
    // what stops a fresh one being minted every time the vault is opened. A migration that
    // came out where the file already was writes nothing (`writeNow`).
    if (migrated || (this.host.index.inSettings && this.host.index.onDisk)) await this.writeNow()
  }

  /**
   * `data.json` changed on disk without this copy of the plugin writing it — another device's
   * copy pulled by Abele Sync or brought by another sync tool. Keeping the settings loaded at
   * startup would write them back over it at the next save, whatever that save was about.
   *
   * Answers whether anything was reloaded, so the caller knows whether the rest of a reload —
   * the secret store, the AI features — has anything to do. It has not when the file says what
   * this copy already holds: a file that came back reserialised, or the second of two calls for
   * one pull. Both are expected. The sync calls this after a run that wrote the file, and
   * Obsidian calls `onExternalSettingsChange` itself for the same write — checked against the
   * installed app (`app.js` in `obsidian.asar`, 2026-09-27): every adapter write, the sync's
   * included, ends in the adapter's `reconcileInternalFile`, which fires the vault's `raw`
   * event; the plugin manager answers a `raw` for an enabled plugin's `data.json` with that
   * plugin's `onConfigFileChange`, debounced 50 ms, which calls `onExternalSettingsChange` when
   * the file's mtime is later than the one the plugin last loaded or saved. The sync writes a
   * pulled file with the mtime it had on the device that saved it, so Obsidian's call is made
   * for most pulls but not for all of them — another device's clock behind this one's, or an
   * older version put back — which is why the sync calls too, and why the second call must be
   * a no-op. Calls are taken one at a time, and in turn with saves, so each sees what the one
   * before it left.
   *
   * What arrived is taken, except for two things:
   * - what this copy changed in memory since it last read or wrote the file — a save waiting
   *   behind this reload — which is put back on top and written;
   * - the synced key store, when this device has one and the file names none. A fresh
   *   install's file, a transfer's or an older build's holds no store, and taking that as the
   *   store turned off would switch it off on every device. The store stays and goes back into
   *   the file; turning it off writes a marker that says so (`storeFile.StoreOff`).
   *
   * A file caught half written — by Obsidian's own save, or another tool's — is read again once after
   * `UNREADABLE_RETRY_MS`; one that still will not parse leaves the settings in memory as they
   * are and blocks every write until a readable one arrives. A file that has gone is not a
   * reason to fall back to defaults either: the settings in memory stay, and the next save
   * writes the file again.
   */
  async reload(): Promise<boolean> {
    const edits = this.host.edits()
    const finishRead = edits.beginRead()
    const base = this.base
    const generation = this.writeGeneration
    try {
      const read = await this.readReload()
      return await this.onFile(() => this.reloadNow(read, base, generation))
    } finally {
      finishRead()
    }
  }

  private async readReload(): Promise<{ stored: unknown; stamp: string | null }> {
    if (!this.host.plugin()) {
      throw new Error('AbeleConfig not initialized with plugin instance.')
    }
    let stamp = await this.readStamp()
    let stored: unknown = await this.host.plugin().loadData()
    if (stored === undefined) {
      console.debug('[Abele] data.json would not parse; reading it again in a moment')
      await pause(UNREADABLE_RETRY_MS)
      if (!this.host.plugin()) return { stored: undefined, stamp }
      stamp = await this.readStamp()
      stored = await this.host.plugin().loadData()
    }
    return { stored, stamp }
  }

  private async reloadNow(
    { stored, stamp }: { stored: unknown; stamp: string | null },
    readBase: AbeleSettings | null,
    readGeneration: number
  ): Promise<boolean> {
    if (!this.host.plugin()) return false
    if (stored === undefined) {
      console.error(
        '[Abele] data.json that arrived could not be read; keeping the settings in memory and not writing to it'
      )
      this.unreadable = true
      this.stamp = stamp
      this.tellUnreadable()
      return false
    }
    if (stored === null) {
      console.debug('[Abele] data.json has gone; keeping the settings in memory')
      // Nothing is on disk now, so the next save has something to write, whatever it is about.
      this.onDisk = null
      this.gone = true
      this.stamp = stamp
      return false
    }
    if (!this.unreadable && isSettingsObject(stored) && canonicalJson(stored) === this.onDisk) {
      this.stamp = stamp
      if (!this.unannounced) {
        console.debug('[Abele] data.json says what this copy already holds; nothing to reload')
        return false
      }
    } else {
      const current =
        readGeneration !== this.writeGeneration && isSettingsObject(stored)
          ? { ...stored, secretStore: this.host.secretStore() }
          : stored
      const settings = this.defaultsInMemory ? current : this.ontoArrived(current, readBase)
      if (
        this.waitingForInitialFile &&
        isSettingsObject(stored) &&
        isSettingsObject(stored.sync) &&
        (stored.sync.serverUrl || stored.sync.deviceTokenId || stored.sync.vaultId)
      ) {
        this.pendingLegacySync = JSON.parse(JSON.stringify(stored.sync))
      }
      this.waitingForInitialFile = false
      await this.take(stored, settings, () => this.host.chatHistory(), stamp)
      // Only the startup load's block is moved: one from another device is never this one's.
      this.loadedSync = null
      // What was put back on top of the file goes into it.
      if (settings !== stored || this.host.edits().hasAcknowledged()) await this.writeNow()
    }
    this.unannounced = false
    this.host.reloaded()
    return true
  }

  /**
   * The settings to apply for a file that arrived: the file, with this copy's key store kept
   * where the file names none, and with what this copy changed in memory since it last read or
   * wrote the file put back on top. The file itself when there is nothing to keep.
   */
  private ontoArrived(stored: unknown, base: AbeleSettings | null = this.base): unknown {
    if (!isSettingsObject(stored)) return stored
    let arrived: Record<string, unknown> = stored
    if (stored.secretStore === undefined && isStoreFile(this.host.secretStore())) {
      console.debug(
        '[Abele] the settings that arrived hold no synced key store; keeping this device’s'
      )
      arrived = { ...stored, secretStore: this.host.secretStore() }
    }
    // The store is one value, never merged leaf by leaf here. A store in the file is not
    // overwritten by this copy's: its entries are merged by the store itself, when it is opened
    // again on what arrived. A marker saying the store is off is taken as it is: this copy's
    // entries put onto it would leave ciphertext in a file that says there is none.
    const keep = ['secretStore']
    const changes =
      base === null
        ? []
        : localChanges(base, this.host.export(), keep).filter(
            (change) => !this.host.edits().pending(change.path)
          )
    if (changes.length > 0) {
      console.debug(
        `[Abele] settings changed here while another copy arrived; keeping ${changes.length} of them on top`
      )
    }
    return changes.length > 0 ? reapply(arrived, changes) : arrived
  }

  /**
   * The `sync` block the startup load read off disk, handed over once — or null when there was
   * no file to read it from: see `loadedSync`.
   */
  acknowledgeSyncMigration(): boolean {
    this.waitingForInitialFile = false
    this.pendingLegacySync = null
    const deferred = this.deferredRewrite
    this.deferredRewrite = false
    return deferred
  }

  takeLoadedSync(): { sync: unknown } | null {
    const block = this.loadedSync
    this.loadedSync = null
    return block
  }

  /**
   * The write on its own, without the feature sync, after every load, reload and write already
   * asked for.
   *
   * A save during `loadSettings` must not register the AI features early: `onload` does that
   * itself, further down, and doing it here would reorder half the plugin's startup.
   */
  write(): Promise<void> {
    // Taken now: a save asked for just before the plugin unloads still reaches the disk.
    const plugin = this.host.plugin()
    if (!plugin) return this.onFile(() => this.writeNow(plugin))
    const current = this.host.export()
    if (this.saveCapture !== null) {
      for (const change of localChanges(this.saveCapture, current, ['secretStore'])) {
        if (change.path[0] === 'ai' && change.path[1] === 'chatHistory') continue
        this.host.edits().recordPatch(change.path, change.value)
      }
    }
    this.saveCapture = current
    return this.onFile(() => this.writeNow(plugin))
  }

  /** `write` for a step already on the queue — a load or a reload writing. */
  private async writeNow(plugin: AbelePlugin | null = this.host.plugin()): Promise<void> {
    if (!plugin) return
    if (this.unreadable) {
      this.tellUnreadable()
      return
    }
    if (this.pendingLegacySync !== null) {
      this.deferredRewrite = true
      return
    }
    if (!(await this.catchUp(plugin))) return
    const accepted = this.host.export()
    const next = accepted
    const text = canonicalJson(next)
    // Nothing changed in meaning: writing would only hand every other device a file to pull
    // and reload for nothing, and a newer mtime to beat whatever they save next.
    if (text === this.onDisk) {
      // A coalesced direct save can return to its starting value. It still resolves
      // as a successful save and must protect that field against an older read.
      this.host.edits().written()()
      this.writeGeneration++
      this.base = accepted
      return
    }
    const written = this.host.edits().written()
    await plugin.saveData(settingsSnapshot(next))
    written()
    this.writeGeneration++
    this.gone = false
    this.onDisk = text
    this.base = accepted
    this.stamp = await this.readStamp(plugin)
  }

  /**
   * Before a write: the file as this copy last read or wrote it, or taken in first when
   * something else wrote it since. A sync writes a pulled file and tells the plugin only when its
   * run is over, and Obsidian's own call comes 50 ms later, so a save can land between the file
   * arriving and its reload — and written from the settings loaded before, it would put them
   * back over the other device's change on every device. So the file is read again, what
   * arrived is taken in with this copy's own changes on top (as a reload does), and the reload
   * that follows is left to reopen the secret store and the AI features (`unannounced`).
   *
   * Answers false when the file will not parse even after a moment: it is left alone, the
   * change stays in memory, and the reload that follows says what is wrong with it.
   */
  private async catchUp(plugin: AbelePlugin): Promise<boolean> {
    let stamp = await this.readStamp(plugin)
    if (stamp === this.stamp) return true
    let fresh: unknown = await plugin.loadData()
    if (fresh === undefined) {
      await pause(UNREADABLE_RETRY_MS)
      stamp = await this.readStamp(plugin)
      fresh = await plugin.loadData()
    }
    if (fresh === undefined) {
      console.debug('[Abele] data.json would not parse just before a save; not writing over it')
      return false
    }
    this.stamp = stamp
    if (!isSettingsObject(fresh)) {
      // Gone, or not settings at all: nothing to take in, and the save writes the file again.
      this.onDisk = null
      return true
    }
    if (canonicalJson(fresh) === this.onDisk) return true
    console.debug('[Abele] data.json changed on disk before this save; taking it in first')
    const settings = this.ontoArrived(fresh)
    // The startup load's block stays for its one reader; one from another device is never
    // this one's (`reloadNow`).
    const loaded = this.loadedSync
    await this.take(fresh, settings, () => this.host.chatHistory(), stamp)
    this.loadedSync = loaded
    this.unannounced = true
    // What reopens the secret store and the AI features on what arrived. The sync asks for it
    // once its run is over and Obsidian when the file's mtime is newer, but a file another tool
    // wrote with an older mtime is announced by neither; the second of two asks finds nothing.
    this.host.arrivedUnannounced()
    return true
  }

  /**
   * The plugin is unloading. A file a pull removed is written again now if no save has done it:
   * see `gone`. Not waited for — nothing on the way out is.
   */
  leaving(): void {
    if (!this.gone || this.unreadable || this.host.plugin() === null) return
    console.debug('[Abele] data.json went and nothing wrote it since; writing it on the way out')
    void this.write()
  }

  /**
   * Said once per unreadable file: saves come from chats as well, and each would repeat it.
   *
   * Not "delete it": the file syncs, and a delete would reach every device, which would each
   * start again from defaults and push those. An earlier copy is in its version history.
   */
  private tellUnreadable(): void {
    if (this.unreadableTold) return
    this.unreadableTold = true
    new Notice(
      'Abele could not read its settings file, so changes to settings are not being saved. ' +
        'Fix the file, or put back an earlier copy of it from its version history, and reload ' +
        'the plugin. Deleting it would remove it from every synced device too.'
    )
  }
}

/**
 * What each tool says of itself, for telling a saved copy of it from an override. Loaded when
 * the settings are, not imported: the tools import these settings, and building them costs
 * nothing that must not happen before the settings exist. Nothing is lost if it fails — the
 * shipped defaults are still recognised.
 */
async function codeToolDescriptions(): Promise<Record<string, string>> {
  try {
    const tools = await import('@/ai/tools')
    return tools.codeToolDescriptions()
  } catch (err) {
    console.debug('[Abele] tool descriptions unavailable while loading settings', err)
    return {}
  }
}
