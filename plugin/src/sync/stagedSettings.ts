import { ref, type Ref } from 'vue'
import type { App } from 'obsidian'
import {
  settingsCategory,
  type DeferredApplied,
  type DeferredKept,
  type SyncReport,
} from '@abele/sync-core'
import type { ChangeItem } from '@abele/sync-protocol'
import type { SyncStatus } from './status'
import type { Reloader } from './reload'

/**
 * Obsidian settings changed on another device, staged by the engine rather than written, and
 * the question about them (phase 3b, decision 11).
 *
 * Obsidian reads its settings and every plugin's `data.json` once, when the vault opens: a file
 * written under it is read by nothing, and the next save writes the old values back. So a pull
 * that brings a change under the config folder leaves it staged, and the person is asked — once
 * per new batch, not at every sync — whether to reload Obsidian with it, keep this device's
 * files instead, or leave it for later. Later is asked again at the next start, or when more is
 * staged. As with held deletes, a question found while the app is not in front waits for it.
 *
 * Abele's own `data.json` is never staged: the plugin reloads it itself (`OwnSettingsWatch`).
 */

/** A question about staged settings: what was shown, and a key for the dialog that shows it. */
export interface StagedQuestion {
  key: number
  changes: ChangeItem[]
  /** Each staged plugin's name by its folder, where this device has its `manifest.json`. */
  names: Record<string, string>
}

/** What the prompt is handed by the service. */
export interface StagedHost {
  /** The changes the running engine holds staged, oldest first; none without an engine. */
  list(): Promise<ChangeItem[]>
  /** Whether the app is in front, where a dialog can be seen. */
  visible(): boolean
  /** The names of the plugins in these folders, read from their `manifest.json` here. */
  names(ids: string[]): Promise<Record<string, string>>
  /** Write what is staged (`SyncEngine.applyDeferred`); null with no engine. */
  apply(): Promise<DeferredApplied | null>
  /** Keep this device's files over what is staged (`SyncEngine.keepLocal`); null with no engine. */
  keep(paths?: string[]): Promise<DeferredKept | null>
  /** A line for the sync log. */
  note(text: string): void
  /** Stop the running engine taking up more work: a reload is about to end it. */
  pause(): void
  /** Take work up again after a reload that did not start, unless the person paused sync. */
  resume(): void
}

/** How many of a sync's staged changes were news: the rule the engine documents. */
export const stagedNews = (report: SyncReport): number =>
  report.pull.deferred + (report.push.deferred ?? 0) + (report.secondPull?.deferred ?? 0)

/** The versions a set of changes stands for, to tell one batch from another. */
const versionsOf = (changes: readonly ChangeItem[]): string =>
  changes
    .map((change) => change.version_id)
    .sort()
    .join(' ')

export class StagedSettingsPrompt {
  /** What is staged now, for the Sync tab; empty when nothing is. */
  readonly staged: Ref<ChangeItem[]> = ref([])
  /** The plugin names for `staged`. */
  readonly names: Ref<Record<string, string>> = ref({})
  /** The question the dialog shows, or null while none is open. */
  readonly asking: Ref<StagedQuestion | null> = ref(null)

  /**
   * Every staged version a question has shown since this start. The list is asked about when
   * it holds one nobody was shown: at a start, everything waiting; after that, a new batch —
   * and Later holds until one arrives, however many reads of the list were under way when it was
   * pressed. A version is never staged twice, so nothing here is forgotten while the app runs.
   */
  private readonly shown = new Set<string>()
  /** A new batch was found while the app was not in front; it is asked when it comes back. */
  private waiting = false
  private asked = 0

  /** `reloader` is the test seam: the e2e and the integration tests count a reload instead. */
  constructor(
    private readonly host: StagedHost,
    public reloader: Reloader
  ) {}

  /**
   * The status moved: read the staged list again when its count no longer matches — which is
   * also the first status of a start, or of an engine built again, that has anything staged.
   * A count of 0 is read too rather than believed: an engine just built says 0 until it has
   * counted what its state holds, and the question open over it would close for nothing.
   */
  async noticed(status: SyncStatus): Promise<void> {
    if (status.deferred === this.staged.value.length) return
    await this.refresh()
  }

  /**
   * A sync got through: read the list again when it staged news — a change that replaced one
   * already staged leaves the count as it was, and is a new version all the same.
   */
  async reported(report: SyncReport): Promise<void> {
    if (stagedNews(report) > 0) await this.refresh()
  }

  /** Read the staged changes again, and ask when they hold one no question has shown. */
  async refresh(): Promise<void> {
    let changes: ChangeItem[]
    let names: Record<string, string>
    try {
      changes = await this.host.list()
      names = await this.host.names(pluginIdsOf(changes))
    } catch (error) {
      console.debug('[abele-sync] the staged settings could not be read', error)
      return
    }
    this.staged.value = changes
    this.names.value = names
    if (changes.length === 0) {
      this.clear()
      return
    }
    this.narrow(changes)
    if (changes.every((change) => this.shown.has(change.version_id))) return
    if (this.host.visible()) this.ask()
    else this.waiting = true
  }

  /**
   * The open question, less what is no longer staged — a local edit sent this device's version
   * of it, or another device's replaced it — so neither answer names a change nobody can act on.
   * Kept under its key, so the dialog is redrawn rather than opened again; closed when nothing it
   * showed is left.
   */
  private narrow(changes: readonly ChangeItem[]): void {
    const open = this.asking.value
    if (open === null) return
    const staged = new Set(changes.map((change) => change.version_id))
    const left = open.changes.filter((change) => staged.has(change.version_id))
    if (left.length === open.changes.length) return
    this.asking.value = left.length === 0 ? null : { ...open, changes: left }
  }

  /** The app came to the front: a question that waited for it is asked now. */
  foreground(): void {
    if (this.waiting && this.staged.value.length > 0 && this.host.visible()) this.ask()
  }

  /**
   * Ask about everything staged now. The dialog already open on the same changes is left as it
   * is, rather than drawn again under whoever reads it. The Sync tab asks nothing: it shows the
   * same answers inline for as long as anything waits.
   */
  ask(): void {
    const changes = this.staged.value
    if (changes.length === 0) return
    this.waiting = false
    for (const change of changes) this.shown.add(change.version_id)
    const open = this.asking.value
    if (open !== null && versionsOf(open.changes) === versionsOf(changes)) return
    this.asking.value = { key: ++this.asked, changes: [...changes], names: { ...this.names.value } }
  }

  /**
   * Reload now: write every staged settings change — but a file changed here since, which is
   * this device's edit and goes out as one — and then reload Obsidian, which reads its settings
   * only when a vault opens. Where Obsidian has no reload command, or nothing was written, it is
   * not reloaded, and the answer says so. Null with no engine to apply them.
   */
  async applyAndReload(): Promise<AppliedSettings | null> {
    const result = await this.host.apply()
    // Closed first: what the read finds that nobody was shown is asked about afresh.
    this.later()
    await this.refresh()
    if (result === null) return null
    this.host.note(
      `applied ${result.applied.length} staged settings file(s)` +
        (result.skipped.length > 0 ? `; ${result.skipped.length} changed here since` : '')
    )
    let reloaded = false
    if (result.applied.length > 0 && this.reloader.available()) {
      this.host.note('reloading Obsidian to read the settings that were applied')
      // Nothing more is started under a reload that is about to end it: a sync that began
      // after the apply would be cut off, and relies only on its journal to come back whole.
      this.host.pause()
      reloaded = this.reloader.reload()
      if (!reloaded) this.host.resume()
    }
    return { applied: result.applied, skipped: result.skipped, reloaded }
  }

  /**
   * Keep this device's: this device's settings files go out over the staged changes — those at
   * `paths`, or all of them — as edits on the server's head, so every other device is asked
   * about them in turn. A file only the other device has is left there; nothing is deleted on
   * any device. Null with no engine.
   */
  async keepLocal(paths?: string[]): Promise<KeptSettings | null> {
    // The versions asked about, as the list stood: whichever of them is still staged afterwards
    // was not kept — another file holds its path here (the engine says so in the log).
    const wanted = paths === undefined ? null : new Set(paths)
    const asked = this.staged.value.filter(
      (change) =>
        wanted === null ||
        wanted.has(change.path) ||
        (change.prev_path !== null && wanted.has(change.prev_path))
    )
    const kept = await this.host.keep(paths)
    this.later()
    await this.refresh()
    if (kept === null) return null
    const still = new Set(this.staged.value.map((change) => change.version_id))
    const blocked = asked
      .filter((change) => still.has(change.version_id))
      .map((change) => change.path)
    this.host.note(
      `keeping this device's settings: ${kept.kept.length} file(s) go out` +
        (kept.left.length > 0 ? `, ${kept.left.length} exist only elsewhere and stay there` : '') +
        (blocked.length > 0 ? `, ${blocked.length} could not be kept` : '')
    )
    return { ...kept, blocked }
  }

  /** Later: the dialog closes and the changes stay staged, asked about at the next start or batch. */
  later(): void {
    this.asking.value = null
    this.waiting = false
  }

  /** Nothing is staged any more. */
  clear(): void {
    this.staged.value = []
    this.names.value = {}
    this.asking.value = null
    this.waiting = false
  }
}

/**
 * The names of the plugins in these config-folder folders, from each one's `manifest.json` on
 * this device; a plugin this device does not have, or whose manifest will not read, is left out,
 * and the dialog shows its folder instead. Read as bytes, as the sync reads the config folder.
 */
export async function pluginNamesIn(
  app: App | null,
  ids: string[]
): Promise<Record<string, string>> {
  const names: Record<string, string> = {}
  if (app === null) return names
  for (const id of ids) {
    try {
      const bytes = await app.vault.adapter.readBinary(
        `${app.vault.configDir}/plugins/${id}/manifest.json`
      )
      const manifest: unknown = JSON.parse(new TextDecoder().decode(bytes))
      const name = (manifest as { name?: unknown } | null)?.name
      if (typeof name === 'string' && name.trim() !== '') names[id] = name.trim()
    } catch {
      // Not here, or not JSON: the folder stands for it.
    }
  }
  return names
}

/* -- What the question says ------------------------------------------------- */

/** What each settings file is called, by the switch that carries it (as on the Sync tab). */
const CATEGORY_NAME: Record<string, string> = {
  main: 'App settings',
  appearance: 'Appearance',
  hotkeys: 'Hotkeys',
  corePlugins: 'Core plugins',
  communityPlugins: 'Community plugins',
}

/** `.obsidian/plugins/<id>/…` → `<id>`, or null for a path outside a plugin's folder. */
function pluginIdOf(wirePath: string): string | null {
  const segments = wirePath.split('/')
  return segments.length >= 3 && segments[1] === 'plugins' ? (segments[2] ?? null) : null
}

/** The plugin folders a set of changes touches, each once, in order of first appearance. */
export function pluginIdsOf(changes: readonly ChangeItem[]): string[] {
  const ids = new Set<string>()
  for (const change of changes) {
    const id = pluginIdOf(change.path)
    if (id !== null) ids.add(id)
  }
  return [...ids]
}

/** What changed, grouped the way a person thinks of it. */
export interface StagedGroups {
  /** Obsidian's own settings, by name: `App settings`, `Hotkeys`… */
  categories: string[]
  /** The plugins whose files changed, by name where this device knows it, else by folder. */
  plugins: string[]
  /** The devices the changes came from. */
  sources: string[]
}

/** Groups staged changes into Obsidian's settings, plugins, and the devices they came from. */
export function groupStaged(
  changes: readonly ChangeItem[],
  names: Record<string, string>
): StagedGroups {
  const categories = new Set<string>()
  const plugins = new Set<string>()
  const sources = new Set<string>()
  for (const change of changes) {
    sources.add(change.actor.name)
    const id = pluginIdOf(change.path)
    if (id !== null) {
      plugins.add(names[id] || id)
      continue
    }
    const category = settingsCategory(change.path)
    categories.add((category !== null && CATEGORY_NAME[category]) || 'Other settings')
  }
  return { categories: [...categories], plugins: [...plugins], sources: [...sources] }
}

/** `a`, `a and b`, `a, b and c`. */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** "App settings, Hotkeys, 2 plugins (Dataview, Tasks)". */
export function stagedSummary(groups: StagedGroups): string {
  const parts = [...groups.categories]
  const count = groups.plugins.length
  if (count > 0) {
    parts.push(`${count === 1 ? '1 plugin' : `${count} plugins`} (${groups.plugins.join(', ')})`)
  }
  return parts.join(', ')
}

/** `1 file`, `3 files`. */
const filesOf = (count: number): string => (count === 1 ? '1 file' : `${count} files`)

/** What "Keep this device's" did: the engine's answer, and the shown files it left staged. */
export interface KeptSettings extends DeferredKept {
  /** Still staged afterwards: another file holds the path here. */
  blocked: string[]
}

/** What "Reload now" did, as `SyncService.applySettingsAndReload` answers it. */
export interface AppliedSettings {
  applied: string[]
  skipped: string[]
  /** Whether Obsidian was reloaded; false where it has no reload command, or nothing was written. */
  reloaded: boolean
}

/** What is said once "Reload now" has run. */
export function appliedNotice(outcome: AppliedSettings | null): string {
  if (outcome === null) return 'Sync is not running on this device, so nothing was applied.'
  const { applied, skipped, reloaded } = outcome
  const lines: string[] = []
  if (applied.length === 0 && skipped.length === 0) {
    return 'These settings are no longer waiting, so nothing was applied.'
  }
  if (applied.length > 0) {
    lines.push(
      reloaded
        ? 'Settings applied; Obsidian is reloading.'
        : 'Settings applied. Restart Obsidian to use them, and change no setting before you ' +
            'do: its save would put the old values back everywhere.'
    )
  }
  if (skipped.length > 0) {
    lines.push(
      `${filesOf(skipped.length)} changed on this device since, so this device's ` +
        `version of ${skipped.length === 1 ? 'it' : 'them'} goes to the other devices instead.`
    )
  }
  return lines.join(' ')
}

/** What is said once "Keep this device's" has run. */
export function keptNotice(kept: KeptSettings | null): string {
  if (kept === null) return 'Sync is not running on this device, so nothing was kept.'
  const lines: string[] = []
  if (kept.kept.length > 0) {
    // "Where they differ": a staged delete kept where this device has no file sends nothing.
    lines.push(
      "This device's settings stay as they are; where they differ, they go to the other " +
        'devices at the next sync.'
    )
  }
  if (kept.left.length > 0) {
    lines.push(
      `${filesOf(kept.left.length)} ${kept.left.length === 1 ? 'exists' : 'exist'} only on the ` +
        'other device and ' +
        `${kept.left.length === 1 ? 'was' : 'were'} left there.`
    )
  }
  if (kept.blocked.length > 0) {
    lines.push(
      `${filesOf(kept.blocked.length)} could not be kept: another file is at that path here. ` +
        'See the sync log.'
    )
  }
  return lines.length > 0 ? lines.join(' ') : 'These settings are no longer waiting.'
}
