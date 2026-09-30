import type { App } from 'obsidian'
import { toRaw } from 'vue'
import type { VaultInfo } from '@abele/sync-protocol'
import type AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { DeviceConnection } from './connection'
import type { ConnectionKeeper } from './connectionKeeper'
import { EngineRunner } from './engineRunner'
import { Enrolment } from './enrolment'
import { factoryOf, transportOf, type SyncServiceDeps } from './environment'
import { HeldDeletesPrompt } from './heldDeletes'
import { askJoin, type JoinQuestion } from './join'
import { finishJoin } from './joinState'
import { ownSettingsPath, settingsArrived, settingsMeaning } from './ownSettings'
import { obsidianReloader } from './reload'
import {
  appliedPathsOf,
  keepAppliedPaths,
  pluginNamesIn,
  StagedSettingsPrompt,
  type StagedHost,
} from './stagedSettings'
import { codePluginIds, pluginCodeNames, stagedLane } from './stagedPluginCode'
import type { StatusBoard } from './statusBoard'

/**
 * The parts `SyncService` is the facade over, made and wired to one another: the engine runner,
 * the enrolment verbs, the two prompts, and the join question. The service hands in what it owns — the app, the
 * connection record, the log, its queue — and keeps what comes back; nothing here holds state.
 */

/** What the parts are wired to: the service's own state, read at the moment it is needed. */
export interface PartsHost {
  app(): App | null
  plugin(): AbelePlugin | null
  deps(): SyncServiceDeps
  keeper: ConnectionKeeper
  board: StatusBoard
  connection(): DeviceConnection
  note(text: string): void
  serialise<T>(fn: () => Promise<T>): Promise<T>
  /** Who a sign-in is telling that a device left, or null (`SyncService.telling`). */
  telling(line: string | null): void
}

export interface ServiceParts {
  runner: EngineRunner
  enrolment: Enrolment
  heldPrompt: HeldDeletesPrompt
  settingsPrompt: StagedSettingsPrompt
  codePrompt: StagedSettingsPrompt
  /** See `SyncService.joinQuestion`. */
  joinQuestion(vault?: VaultInfo): Promise<JoinQuestion>
}

/** Whether the app is in front; a test with no document counts as in front. */
const visible = (): boolean =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden'

export function wireParts(host: PartsHost): ServiceParts {
  /** The engine itself: building, keeping in step, taking down (`engineRunner.ts`). */
  const runner: EngineRunner = new EngineRunner(
    {
      app: () => host.app(),
      manifest: () => host.plugin()?.manifest ?? { id: 'abele' },
      deps: () => host.deps(),
      connection: () => host.connection(),
      token: () => host.keeper.token(),
      damage: () => host.keeper.damage(),
      serialise: <T>(fn: () => Promise<T>) => host.serialise(fn),
      settingsArrived: (replaced) =>
        settingsArrived({ plugin: host.plugin(), note: (text) => host.note(text) }, replaced),
      settingsMeaning: () => settingsMeaning(host.plugin()),
      settingsApplied: (path) => settingsPrompt.recordApplied(path),
      joined: (join) =>
        finishJoin(
          {
            connection: () => host.connection(),
            save: (patch) => host.keeper.save(patch),
            note: (text) => host.note(text),
            reconcile: () => void host.serialise(() => runner.reconcile()),
          },
          join
        ),
      synced: (report) => {
        void settingsPrompt.reported(report)
        void codePrompt.reported(report)
      },
    },
    host.board
  )

  /** Setting this device up and taking it down again (`enrolment.ts`). */
  const enrolment = new Enrolment({
    app: () => host.app(),
    transport: () => transportOf(host.deps()),
    factory: () => factoryOf(host.deps()),
    note: (text) => host.note(text),
    connection: () => host.connection(),
    saveConnection: (patch) => host.keeper.save(patch),
    serialise: <T>(fn: () => Promise<T>) => host.serialise(fn),
    teardown: () => runner.teardown(),
    reconcile: () => runner.reconcile(),
    telling: (line) => host.telling(line),
  })

  /**
   * Many files deleted at once, held back by the engine, and the question about them
   * (`heldDeletes.ts`). Told of every status; the dialog and the Sync tab read it.
   */
  const heldPrompt = new HeldDeletesPrompt({
    list: () => runner.heldDeletes(),
    visible,
    decide: (kind, fileIds) => runner.decideDeletes(kind, fileIds),
    note: (text) => host.note(text),
  })

  /**
   * Obsidian settings changed on another device, staged by the engine until the person says
   * what to do with them, and the question about them (`stagedSettings.ts`). Its `reloader` is
   * the seam a test replaces so that "Reload now" reloads nothing.
   */
  const stagedHost: StagedHost = {
    list: () => runner.deferred(),
    apply: (versionIds) => runner.applyDeferred(versionIds),
    keep: (paths, versionIds) => runner.keepLocal(paths, versionIds),
    visible,
    appliedWaiting: () => appliedPathsOf(host.app()),
    keepApplied: (paths) => keepAppliedPaths(host.app(), paths),
    names: (ids) => pluginNamesIn(host.app(), ids),
    note: (text) => host.note(text),
    pause: () => runner.pause(),
    resume: () => {
      if (!host.connection().paused) runner.resume()
    },
  }
  const ownFolder = (): string => {
    const app = host.app()
    const manifest = host.plugin()?.manifest ?? { id: 'abele' }
    return app === null
      ? manifest.id
      : (ownSettingsPath(app.vault.configDir, manifest).split('/').at(-2) ?? manifest.id)
  }
  const isCode = (change: Parameters<typeof codePluginIds>[0]): boolean =>
    codePluginIds(change, ownFolder()).length > 0
  const settingsPrompt = new StagedSettingsPrompt(
    stagedLane(stagedHost, (change) => !isCode(change)),
    obsidianReloader(() => host.app())
  )
  const codePrompt = new StagedSettingsPrompt(
    stagedLane(
      {
        ...stagedHost,
        names: (_ids, changes) =>
          pluginCodeNames(host.app(), runner.client(), changes, ownFolder()),
      },
      isCode
    ),
    obsidianReloader(() => host.app())
  )

  const joinQuestion = (vault?: VaultInfo): Promise<JoinQuestion> => {
    const app = host.app()
    if (app === null) throw new Error('the sync service has not been started yet')
    return askJoin({
      app,
      factory: factoryOf(host.deps()),
      connection: toRaw(host.connection()),
      token: host.keeper.token(),
      transport: transportOf(host.deps()),
      timeoutMs: enrolment.revoker.timeoutMs,
      scriptsFolder: AbeleConfig.getInstance().ai.scriptsFolder,
      ownSettings: ownSettingsPath(app.vault.configDir, host.plugin()?.manifest ?? { id: 'abele' }),
      note: (text) => host.note(text),
      vault,
    })
  }

  return { runner, enrolment, heldPrompt, settingsPrompt, codePrompt, joinQuestion }
}
