import type { StateEntry } from '@abele/sync-core'
import { caseKey } from '@abele/sync-protocol'

/** The engine's ledger, as much of it as `yields` asks. */
interface Ledger {
  get(path: string): Promise<StateEntry | null>
}

/**
 * Whether a sync run wrote the plugin's own `data.json`, and telling the plugin once it has.
 *
 * Abele's settings file syncs like any other plugin's (it names no device: the connection is in
 * local storage). A pull that writes it has to be followed by a reload, or the settings loaded at
 * startup stay in memory and the next save writes them back over what arrived. The engine only
 * writes what it pulls, so every write `ObsidianFileSystem` reports for this path is another
 * device's settings; they are collected over a run and the plugin is told once, when the run is
 * over — a run can write the file in both of its pulls, and a reload between the two would read
 * the first.
 *
 * Obsidian tells the plugin as well, for most of these writes (see
 * `AbeleConfig.reloadSettings`); the reload that finds the file already read does nothing, so
 * the two never reload twice.
 */
export class OwnSettingsWatch {
  private readonly own: string
  private written = false
  private ledger: Ledger | null = null
  /**
   * What the file said when this run first reported it as yielding (`yields`), or null while it
   * has not: what the vault's copy, if it is written here, replaced.
   */
  private before: string | null = null

  /**
   * `path` is the settings file's wire path — `.obsidian/plugins/<id>/data.json` — and `tell`
   * what reloads it; it is handed what the file said before the run wrote the vault's copy
   * over this device's own, at a first contact, and null otherwise. `snapshot` reads what the
   * file says now. Compared case-folded: a case-insensitive disk hands the same file back
   * under any spelling.
   */
  constructor(
    path: string,
    private readonly tell: (replaced: string | null) => void,
    private readonly snapshot: () => Promise<string> = async () => ''
  ) {
    this.own = caseKey(path)
  }

  /** The ledger `yields` asks, once the engine's state database is open. */
  useLedger(ledger: Ledger): void {
    this.ledger = ledger
  }

  /**
   * Whether `path` is the settings file and the ledger does not hold it yet — this device has
   * never synced it. Its first contact with the server's copy then goes the server's way
   * (`ObsidianFileSystemOptions.yieldsToServer`).
   *
   * A device's own `data.json` exists before it first syncs: a fresh install writes defaults
   * and a new Comment agent at its first launch, a settings transfer writes some sections and
   * no key store, and a build that kept the file to itself never put it in the ledger. Sent as
   * it stands, it is a create against the vault's head, which the server gives to the newer
   * mtime — the newcomer's, nearly always — and every device would take its settings and lose
   * theirs. Reported as the oldest file there is, it loses that race instead: the server keeps
   * its head, keeps this copy as a version in the file's history, and the head is written here
   * and reloaded like any other pull of it. Where the server has no such file yet, this copy
   * becomes it.
   *
   * No ledger, or one that will not answer, and the file is left as it is.
   */
  async yields(path: string): Promise<boolean> {
    if (this.ledger === null || caseKey(path) !== this.own) return false
    try {
      const yielding = (await this.ledger.get(path)) === null
      if (yielding && this.before === null) this.before = await this.snapshot()
      return yielding
    } catch (error) {
      console.debug('[abele-sync] the ledger would not say whether it holds the settings', error)
      return false
    }
  }

  /** The engine wrote, moved or removed a file at `path` (`onEngineWrite`). */
  noteWrite(path: string): void {
    if (caseKey(path) === this.own) this.written = true
  }

  /**
   * A run is over, whether it got through or failed: whatever it wrote is on disk. Tells the
   * plugin if the settings file was among it, and, when that write was the vault's copy taking
   * the place of this device's at a first contact, what the file said before it.
   */
  settle(): void {
    const before = this.before
    this.before = null
    if (!this.written) return
    this.written = false
    this.tell(before)
  }
}
