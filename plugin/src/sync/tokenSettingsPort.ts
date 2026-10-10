import { computed } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { tokenUi, type TokenUi } from './tokenUi'
import { historyConnection } from './tokenHistory'
import { defaultSelective } from './connection'
import { HeldDeletesPrompt } from './heldDeletes'
import { StagedSettingsPrompt, appliedPathsOf, keepAppliedPaths } from './stagedSettings'
import { obsidianReloader } from './reload'
import { executablePath } from './stagedPluginCode'
import { DISCONNECTED_STATUS } from './status'

/** Thin per-connection settings actions; exchange and durable decisions remain in core. */
export class TokenSettingsPort {
  private static readonly instances = new WeakMap<TokenUi, Map<string, TokenSettingsPort>>()
  static getInstance(): TokenSettingsPort {
    const ui = tokenUi.value
    if (!ui) throw new Error('Connections are not available')
    const id = historyConnection.value ?? ui.registry.selectedId
    return this.forConnection(ui, id)
  }
  static forConnection(ui: TokenUi, id: string): TokenSettingsPort {
    let instances = this.instances.get(ui)
    if (!instances) this.instances.set(ui, (instances = new Map()))
    let port = instances.get(id)
    if (!port) instances.set(id, (port = new TokenSettingsPort(ui, id)))
    return port
  }
  readonly connection
  readonly status
  readonly heldPrompt: HeldDeletesPrompt
  readonly settingsPrompt: StagedSettingsPrompt
  private constructor(
    private readonly ui: TokenUi,
    private readonly id: string
  ) {
    const app = GlobalStore.getInstance().app
    this.connection = computed(() => ({
      selective: ui.rows.value.find((one) => one.id === id)?.selective ?? defaultSelective(),
    }))
    this.status = computed(
      () =>
        ({
          ...DISCONNECTED_STATUS,
          state: ui.rows.value.find((one) => one.id === id)?.status ?? 'disconnected',
        }) as typeof DISCONNECTED_STATUS
    )
    const runtime = () => ui.runtimes.get(id)
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
    this.heldPrompt = new HeldDeletesPrompt({
      list: async () => (await runtime()?.heldDeletes?.()) ?? [],
      visible,
      decide: (kind, ids) => this.decideDeletes(kind, ids),
      note: () => {},
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
        note: () => {},
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
  updateConnection(patch: { selective: import('@abele/sync-core').SelectiveSettings }) {
    return this.ui.updateConnection(this.id, patch)
  }
  decideDeletes(kind: 'confirm' | 'restore', ids: readonly string[]) {
    return this.ui.runtimes.get(this.id)?.decideDeletes?.(kind, ids) ?? Promise.resolve(null)
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
  note(_text: string): void {}
}
