import { computed, ref } from 'vue'
import type { App } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { tokenUi, type TokenUi } from './tokenUi'
import { historyConnection } from './tokenHistory'
import { defaultSelective } from './connection'
import { HeldDeletesPrompt } from './heldDeletes'
import { StagedSettingsPrompt, appliedPathsOf, keepAppliedPaths } from './stagedSettings'
import { obsidianReloader } from './reload'
import { executablePath } from './stagedPluginCode'
import { DISCONNECTED_STATUS, statusOf } from './status'

/** Thin per-connection settings actions; exchange and durable decisions remain in core. */
export class TokenSettingsPort {
  private static readonly instances = new WeakMap<TokenUi, Map<string, TokenSettingsPort>>()
  static forget(ui: TokenUi, id: string): void {
    this.instances.get(ui)?.delete(id)
  }
  static getInstance(): TokenSettingsPort {
    const ui = tokenUi.value
    if (!ui) throw new Error('Connections are not available')
    const id = historyConnection.value ?? ui.registry.selectedId
    return this.forConnection(ui, id)
  }
  static forConnection(
    ui: TokenUi,
    id: string,
    app = GlobalStore.getInstance().app
  ): TokenSettingsPort {
    let instances = this.instances.get(ui)
    if (!instances) this.instances.set(ui, (instances = new Map()))
    let port = instances.get(id)
    if (!port) instances.set(id, (port = new TokenSettingsPort(ui, id, app)))
    return port
  }
  readonly connection
  get connectionId(): string {
    return this.id
  }
  readonly status
  readonly heldPrompt: HeldDeletesPrompt
  readonly settingsPrompt: StagedSettingsPrompt
  readonly log = ref<string[]>([])
  private constructor(
    private readonly ui: TokenUi,
    private readonly id: string,
    app: App
  ) {
    this.connection = computed(() => ({
      selective: ui.rows.value.find((one) => one.id === id)?.selective ?? defaultSelective(),
    }))
    this.status = computed(
      () =>
        ({
          ...DISCONNECTED_STATUS,
          state: ui.rows.value.find((one) => one.id === id)?.status ?? 'disconnected',
          lastSyncAt:
            ui.activity.value[id]?.lastSync === undefined
              ? null
              : new Date(ui.activity.value[id].lastSync).toISOString(),
          pending: ui.activity.value[id]?.pending ?? 0,
          heldDeletes: ui.activity.value[id]?.heldDeletes ?? 0,
          deferred: ui.activity.value[id]?.deferred ?? 0,
        }) as typeof DISCONNECTED_STATUS
    )
    const runtime = () => ui.runtimes.get(id)
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
    this.heldPrompt = new HeldDeletesPrompt({
      list: async () => (await runtime()?.heldDeletes?.()) ?? [],
      visible,
      decide: async (kind, ids) => (await runtime()?.decideDeletes?.(kind, ids)) ?? null,
      note: (text) => this.note(text),
    })
    this.settingsPrompt = new StagedSettingsPrompt(
      {
        list: async () =>
          ((await runtime()?.deferred?.()) ?? []).filter((one) => !executablePath(one.path)),
        visible,
        names: async () => ({}),
        apply: async (ids) => {
          const allowed = new Set(
            ((await runtime()?.deferred?.()) ?? [])
              .filter((one) => !executablePath(one.path))
              .map((one) => one.version_id)
          )
          return (await runtime()?.applyDeferred?.(ids.filter((one) => allowed.has(one)))) ?? null
        },
        keep: async (paths, ids) => (await runtime()?.keepLocal?.(paths, ids)) ?? null,
        appliedWaiting: () => appliedPathsOf(app),
        keepApplied: (paths) => keepAppliedPaths(app, paths),
        note: (text) => this.note(text),
        pause: () => {
          void runtime()?.pause(true)
        },
        resume: () => {
          if (!ui.rows.value.find((one) => one.id === id)?.paused) void runtime()?.pause(false)
        },
      },
      obsidianReloader(() => app)
    )
    this.settingsPrompt.restoreAppliedWaiting()
  }
  updateConnection(patch: { selective: import('@abele/sync-sdk/core').SelectiveSettings }) {
    return this.ui.updateConnection(this.id, patch)
  }
  decideDeletes(kind: 'confirm' | 'restore', ids: readonly string[]) {
    return this.heldPrompt.decide(kind, ids)
  }
  applySettingsAndReload(ids: readonly string[]) {
    return this.settingsPrompt.applyAndReload(ids)
  }
  keepLocalSettings(paths: string[] | undefined, ids: readonly string[]) {
    return this.settingsPrompt.keepLocal(paths, ids)
  }
  reloadAppliedSettings() {
    return this.settingsPrompt.reloadApplied()
  }
  async noticed(
    status: import('@abele/sync-sdk/core').EngineStatus,
    report?: import('@abele/sync-sdk/core').SyncReport
  ): Promise<void> {
    await this.heldPrompt.noticed(statusOf(status))
    await this.settingsPrompt.noticed(statusOf(status))
    if (report) {
      this.note(`sync: done (pushed ${report.push.applied})`)
      await this.settingsPrompt.reported(report)
    }
  }
  note(text: string): void {
    this.log.value = [...this.log.value, text].slice(-500)
  }
}
