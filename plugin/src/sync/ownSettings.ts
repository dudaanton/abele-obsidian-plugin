import { caseKey } from '@abele/sync-protocol'

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

  /**
   * `path` is the settings file's wire path — `.obsidian/plugins/<id>/data.json` — and `tell`
   * what reloads it. Compared case-folded: a case-insensitive disk hands the same file back
   * under any spelling.
   */
  constructor(
    path: string,
    private readonly tell: () => void
  ) {
    this.own = caseKey(path)
  }

  /** The engine wrote, moved or removed a file at `path` (`onEngineWrite`). */
  noteWrite(path: string): void {
    if (caseKey(path) === this.own) this.written = true
  }

  /**
   * A run is over, whether it got through or failed: whatever it wrote is on disk. Tells the
   * plugin if the settings file was among it.
   */
  settle(): void {
    if (!this.written) return
    this.written = false
    this.tell()
  }
}
