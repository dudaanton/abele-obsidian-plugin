import { t } from '@/i18n'
import { vaultDisk } from './vaultPathLinks'
import { ref, type Ref } from 'vue'
import type { App } from 'obsidian'
import {
  settingsCategory,
  type DeferredApplied,
  type DeferredKept,
  type SyncReport,
} from '@abele/sync-sdk/core'
import type { ChangeItem } from '@abele/sync-sdk/protocol'
import type { SyncStatus } from './status'

const APPLIED_SLOT = Symbol.for('abele.sync.settings-applied')
type AppliedHost = { [APPLIED_SLOT]?: string[] }

/** Survives a plugin bundle reload, but a new App after an application reload has read the files. */
export function appliedPathsOf(app: object | null): string[] {
  return app === null ? [] : [...((app as AppliedHost)[APPLIED_SLOT] ?? [])]
}
export function keepAppliedPaths(app: object | null, paths: string[]): void {
  if (app === null) return
  if (paths.length) (app as AppliedHost)[APPLIED_SLOT] = [...paths]
  else delete (app as AppliedHost)[APPLIED_SLOT]
}

export interface DeferredSettingsBatch extends DeferredApplied {
  failed?: { path: string; reason: string }[]
  incomplete?: string
}
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
  names(ids: string[], changes: readonly ChangeItem[]): Promise<Record<string, string>>
  /**
   * Write what is staged at the versions shown (`SyncEngine.applyDeferred`); null with no
   * engine. The rest stays staged and comes back in `unshown`.
   */
  apply(versionIds: readonly string[]): Promise<DeferredSettingsBatch | null>
  /**
   * Keep this device's files over what is staged at the versions shown, at `paths` or all
   * (`SyncEngine.keepLocal`); null with no engine.
   */
  keep(paths: string[] | undefined, versionIds: readonly string[]): Promise<DeferredKept | null>
  /** Read/write plain application-lifetime bookkeeping, not a ref from an old Vue bundle. */
  appliedWaiting?(): string[]
  keepApplied?(paths: string[]): void
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
  /** Already written, but not read by Obsidian until a reload. Kept even when staging empties. */
  readonly appliedWaiting: Ref<string[]> = ref([])
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
  private reading = 0

  /** `reloader` is the test seam: the e2e and the integration tests count a reload instead. */
  constructor(
    private readonly host: StagedHost,
    public reloader: Reloader
  ) {}

  restoreAppliedWaiting(): void {
    this.appliedWaiting.value = this.host.appliedWaiting?.() ?? this.appliedWaiting.value
  }

  recordApplied(path: string): void {
    this.restoreAppliedWaiting()
    this.appliedWaiting.value = [...new Set([...this.appliedWaiting.value, path])]
    this.host.keepApplied?.(this.appliedWaiting.value)
  }

  private readApplied(): void {
    this.appliedWaiting.value = []
    this.host.keepApplied?.([])
  }

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
    const reading = ++this.reading
    let changes: ChangeItem[]
    let names: Record<string, string>
    try {
      changes = await this.host.list()
      names = await this.host.names(pluginIdsOf(changes), changes)
    } catch (error) {
      console.debug('[abele-sync] the staged settings could not be read', error)
      return
    }
    // Manifest reads can involve the network. An older snapshot must not replace a newer one.
    if (reading !== this.reading) return
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
   * Reload now: write the staged settings changes at the versions the person was shown
   * (`versionIds`) — but a file changed here since, which is this device's edit and goes out as
   * one — and then reload Obsidian, which reads its settings only when a vault opens. Where
   * Obsidian has no reload command, or nothing was written, it is not reloaded, and the answer
   * says so. Null with no engine to apply them.
   *
   * Only what was shown (pi review #3): a setting staged while the question was open, or a newer
   * version of one it showed, stays staged and unwritten. Then Obsidian is not reloaded either —
   * a reload would start whatever that change was, plugin code included, before anyone saw it —
   * and the question is asked again about those.
   */
  async applyAndReload(versionIds: readonly string[]): Promise<AppliedSettings | null> {
    const result = await this.host.apply(versionIds)
    if (result !== null) result.applied.forEach((path) => this.recordApplied(path))
    const unshown = result?.unshown ?? []
    this.askAgain(unshown)
    // Closed first: what the read finds that nobody was shown is asked about afresh.
    this.later()
    await this.refresh()
    if (result === null) return null
    this.host.note(
      `applied ${result.applied.length} staged settings file(s)` +
        (result.skipped.length > 0 ? `; ${result.skipped.length} changed here since` : '') +
        (unshown.length > 0 ? `; ${unshown.length} changed since they were shown, asked again` : '')
    )
    let reloaded = false
    if (
      this.appliedWaiting.value.length > 0 &&
      unshown.length === 0 &&
      !result.failed?.length &&
      !result.incomplete &&
      this.reloader.available()
    ) {
      this.host.note('reloading Obsidian to read the settings that were applied')
      // Nothing more is started under a reload that is about to end it: a sync that began
      // after the apply would be cut off, and relies only on its journal to come back whole.
      this.host.pause()
      reloaded = this.reloader.reload()
      if (!reloaded) this.host.resume()
      else this.readApplied()
    }
    return {
      applied: result.applied,
      skipped: result.skipped,
      reloaded,
      unshown: unshown.map((change) => change.path),
      ...(result.failed?.length ? { failed: result.failed } : {}),
      ...(result.incomplete ? { incomplete: result.incomplete } : {}),
    }
  }

  /** Explicitly reload what was already written, without retrying failed or unshown files. */
  reloadApplied(): boolean {
    if (this.appliedWaiting.value.length === 0 || !this.reloader.available()) return false
    this.host.pause()
    const reloaded = this.reloader.reload()
    if (reloaded) this.readApplied()
    else this.host.resume()
    return reloaded
  }

  /**
   * Keep this device's: this device's settings files go out over the staged changes at the
   * versions shown — those at `paths`, or all of them — as edits on the server's head, so every
   * other device is asked about them in turn. A file only the other device has is left there;
   * nothing is deleted on any device. A newer version than the one shown is not kept over: it
   * stays staged and is asked about. Null with no engine.
   */
  async keepLocal(
    paths: string[] | undefined,
    versionIds: readonly string[]
  ): Promise<KeptSettings | null> {
    // The versions asked about, as the list stood: whichever of them is still staged afterwards
    // was not kept — another file holds its path here (the engine says so in the log).
    const wanted = paths === undefined ? null : new Set(paths)
    const answered = new Set(versionIds)
    const asked = this.staged.value.filter(
      (change) =>
        answered.has(change.version_id) &&
        (wanted === null ||
          wanted.has(change.path) ||
          (change.prev_path !== null && wanted.has(change.prev_path)))
    )
    const kept = await this.host.keep(paths, versionIds)
    const unshown = kept?.unshown ?? []
    this.askAgain(unshown)
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
        (blocked.length > 0 ? `, ${blocked.length} could not be kept` : '') +
        (unshown.length > 0 ? `, ${unshown.length} changed since they were shown` : '')
    )
    return {
      kept: kept.kept,
      left: kept.left,
      blocked,
      unshown: unshown.map((change) => change.path),
    }
  }

  /** Changes an answer did not cover, asked about again as though nobody had seen them. */
  private askAgain(unshown: readonly ChangeItem[]): void {
    for (const change of unshown) this.shown.delete(change.version_id)
  }

  /** Later: the dialog closes and the changes stay staged, asked about at the next start or batch. */
  later(questionKey?: number): void {
    // A keyed modal emits close while unmounting, including when a newer question replaces it.
    if (questionKey !== undefined && this.asking.value?.key !== questionKey) return
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
      const bytes = await vaultDisk(app.vault).readBinary(
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
  get main() {
    return t('streamC.d43fb8a961ff2d1f')
  },
  get appearance() {
    return t('streamC.3907fa7f80722a6f')
  },
  get hotkeys() {
    return t('streamC.c15f1530d219f94a')
  },
  get corePlugins() {
    return t('streamC.f2e957b0c48b1e30')
  },
  get communityPlugins() {
    return t('streamC.ab57440204b1ffa5')
  },
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
    categories.add((category !== null && CATEGORY_NAME[category]) || t('streamC.a69ace7e2616860c'))
  }
  return { categories: [...categories], plugins: [...plugins], sources: [...sources] }
}

/** `a`, `a and b`, `a, b and c`. */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return t('streamC.2cc968ac50f81c8c', {
    v1: String(items.slice(0, -1).join(', ')),
    v2: String(items[items.length - 1]),
  })
}

/** "App settings, Hotkeys, 2 plugins (Dataview, Tasks)". */
export function stagedSummary(groups: StagedGroups): string {
  const parts = [...groups.categories]
  const count = groups.plugins.length
  if (count > 0) {
    parts.push(`${t('streamC.plugins', { count: count })} (${groups.plugins.join(', ')})`)
  }
  return parts.join(', ')
}

/** What "Keep this device's" did: the engine's answer, and the shown files it left staged. */
export interface KeptSettings extends Omit<DeferredKept, 'unshown'> {
  /** Still staged afterwards: another file holds the path here. */
  blocked: string[]
  /** Changed since they were shown, so not kept over: asked about again. */
  unshown: string[]
}

/** What "Reload now" did, as `SyncService.applySettingsAndReload` answers it. */
export interface AppliedSettings {
  applied: string[]
  failed?: { path: string; reason: string }[]
  incomplete?: string
  skipped: string[]
  /**
   * Whether Obsidian was reloaded; false where it has no reload command, where nothing was
   * written, or where something changed since it was shown.
   */
  reloaded: boolean
  /** Changed since they were shown, so not written: asked about again. */
  unshown: string[]
}

/** What is said once "Reload now" has run. */
export function appliedNotice(outcome: AppliedSettings | null): string {
  if (outcome === null) return t('streamC.5ecbd7317810f741')
  const { applied, skipped, reloaded, unshown, failed = [], incomplete } = outcome
  const lines: string[] = []
  if (failed.length > 0 || incomplete) {
    const written = applied.length
      ? t('streamC.eb17fcb925416282', { v1: applied.length, v2: applied.join(', ') })
      : t('streamC.7274ea9cce48d9cd')
    return (
      written +
      (failed.length
        ? t('streamC.6ac8070de87d954a', {
            v1: failed.length,
            v2: failed.map((one) => `${one.path} (${one.reason})`).join('; '),
          })
        : '') +
      (incomplete ? t('streamC.4c73345bf0a38de1', { v1: incomplete }) : '') +
      (applied.length ? t('streamC.ab50f04a8353867a') : t('streamC.3a2ed8d8e0351187'))
    )
  }
  if (applied.length === 0 && skipped.length === 0 && unshown.length === 0)
    return t('streamC.51b2bfb032c1855f')
  if (applied.length > 0)
    lines.push(
      reloaded
        ? t('streamC.5f3ff96c7a50e7af')
        : unshown.length > 0
          ? t('streamC.1277bcb461f8bfa9')
          : t('streamC.8eca7f40d690066b')
    )
  if (unshown.length > 0) lines.push(t('streamC.stagedChanged', { count: unshown.length }))
  if (skipped.length > 0) lines.push(t('streamC.stagedSkipped', { count: skipped.length }))
  return lines.join(' ')
}

/** What is said once the local settings were kept. */
export function keptNotice(kept: KeptSettings | null): string {
  if (kept === null) return t('streamC.7f5c74442714d8b3')
  const lines: string[] = []
  if (kept.kept.length > 0) lines.push(t('streamC.a6a16993eff6bd8c'))
  if (kept.left.length > 0) lines.push(t('streamC.stagedLeft', { count: kept.left.length }))
  if (kept.blocked.length > 0)
    lines.push(t('streamC.stagedBlocked', { count: kept.blocked.length }))
  if (kept.unshown.length > 0)
    lines.push(t('streamC.stagedUnshown', { count: kept.unshown.length }))
  return lines.length > 0 ? lines.join(' ') : t('streamC.448adbdbb4785252')
}
