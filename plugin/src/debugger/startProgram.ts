import { t } from '@/i18n'
// Starting a program of a node chat's folder under the debugger: the node runs it with its own
// Node and holds it on its first line; the program's file opens with its margin, so record points
// and breakpoints go in before it goes on. Files open from the same folder take breakpoints too.
import { Notice, Platform, type Workspace } from 'obsidian'
import { watch } from 'vue'
import { z } from 'zod'
import { debuggerAcceptanceCapabilities } from '@/node/acceptanceCapabilities'
import { debugIdentity, debugOwnerParams, debugTarget, type DebugOwner } from './owner'
import type { PathTarget } from '@/node/NodePathModel'
import { NODE_FILE_VIEW, NodePathTabSchema, openNodePathTab } from '@/node/nodePathNavigation'
import { NodeSuggestModal, type NodeSuggestion } from '@/components/nodeWork/NodeSuggestModal'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService, type DebuggerBinding } from './DebuggerService'
import { programFiles } from './programFiles'
import { pickProgram } from '@/helpers/suggesters/RunnablePicker'
import { openComponentDialog } from '@/modal/componentDialog'
import ProgramLaunchDialog from './ProgramLaunchDialog.vue'
import {
  programLaunchPaths,
  programLaunchTargets,
  resolveLaunchTarget,
} from './programLaunchTargets'

const id = z.string().min(1).max(128)
export const StartResultSchema = z.object({
  debug_session_id: id,
  sources: z.array(z.object({ source_id: id, path: z.string().max(4096) })).max(256),
})
export type StartResult = z.infer<typeof StartResultSchema>
const StatusSchema = z.object({ snapshot: z.object({ incarnation: id }).loose() }).loose()

const RUNNABLE = /\.[cm]?js$/
/** What takes breakpoints: JavaScript as it runs, and TypeScript the node maps through its build. */
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** The chat's folder as a node file tab addresses it; undefined while the chat has none. */
export const chatTarget = debugTarget

export const sameFolder = (a: PathTarget, b: PathTarget) =>
  a.registrationId === b.registrationId && a.kind === b.kind && a.id === b.id

/** Code files open from this folder in node file tabs, the active one first. */
export function openFilesOf(workspace: Workspace, target: PathTarget): string[] {
  const active = workspace.getMostRecentLeaf()
  const leaves = workspace.getLeavesOfType(NODE_FILE_VIEW)
  leaves.sort((a, b) => Number(b === active) - Number(a === active))
  const paths: string[] = []
  for (const leaf of leaves) {
    const state = NodePathTabSchema.safeParse(leaf.getViewState().state)
    if (
      state.success &&
      state.data.kind === 'file' &&
      sameFolder(state.data.target, target) &&
      SOURCE.test(state.data.path) &&
      !paths.includes(state.data.path)
    )
      paths.push(state.data.path)
  }
  return paths
}

/** The program offered to run: the first JavaScript file open, as Node runs only JavaScript. */
export function defaultProgram(open: string[]) {
  return open.find((path) => RUNNABLE.test(path)) ?? ''
}

/** A point of a run, carried to the program's next run: where it stands, what it takes if it records. */
export interface CarriedPoint {
  path: string
  line: number
  condition?: string
  log_message?: string
  hit_condition?: string
  enabled?: boolean
  take?: string[]
  note?: string
}

/** The breakpoints and record points the program's session holds now, by file and line. */
export function carriedPoints(binding: DebuggerBinding): CarriedPoint[] {
  return binding.controller.knownBreakpoints().flatMap((b) => {
    if (!b.file) return []
    const point = binding.trace?.points.find((p) => p.breakpoint_id === b.id)
    return [
      {
        path: b.file,
        line: b.requestedLine,
        ...(b.condition ? { condition: b.condition } : {}),
        ...(b.log_message ? { log_message: b.log_message } : {}),
        ...(b.hit_condition ? { hit_condition: b.hit_condition } : {}),
        ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
        ...(point ? { take: point.take } : {}),
        ...(point?.note ? { note: point.note } : {}),
      },
    ]
  })
}

/** How long a new run may take to stop on its first line before its points are sent anyway. */
const HOLD_MS = 10_000

/** Resolves once the session stands still (held, ended or cut off), or after HOLD_MS. */
function untilHeld(binding: DebuggerBinding): Promise<void> {
  const still = () =>
    binding.controller.session.status !== 'starting' &&
    binding.controller.session.status !== 'running'
  if (still()) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      stop()
      window.clearTimeout(timer)
      resolve()
    }
    const stop = watch(binding.revision, () => {
      if (still()) done()
    })
    const timer = window.setTimeout(() => {
      console.debug('[debugger] New run not held yet; carrying its points anyway')
      done()
    }, HOLD_MS)
  })
}

/** Tells the panel which file each source id of a new session is, so breakpoints read as files. */
export async function registerSources(
  presenter: DebugOwner,
  started: StartResult,
  target: PathTarget
) {
  const { snapshot } = StatusSchema.parse(
    await presenter.connection.client.request('debugger.v1.status', {
      debug_session_id: started.debug_session_id,
    })
  )
  DebuggerService.instance.trackFolder(presenter, started.debug_session_id, target)
  for (const s of started.sources)
    DebuggerService.instance.registerSource(
      debugIdentity(presenter).registrationId,
      DebuggerService.instance.binding(presenter, started.debug_session_id).conversationId,
      s.source_id,
      s.path,
      started.debug_session_id,
      snapshot.incarnation,
      target
    )
  return snapshot
}

/** Gives the files a new session took their margin: those already open from the chat's folder
 * where they are, and `main` (the program's own file, else the first one taken) in a tab. */
export async function openSources(
  presenter: DebugOwner,
  started: StartResult,
  incarnation: string,
  target: PathTarget,
  main?: string
) {
  const debugOf = (sourceId: string) => ({
    conversationId: DebuggerService.instance.binding(presenter, started.debug_session_id)
      .conversationId,
    sourceId,
    debugSessionId: started.debug_session_id,
    incarnation,
  })
  const source = started.sources.find((s) => s.path === main) ?? started.sources[0]
  const { workspace } = GlobalStore.getInstance().app
  for (const leaf of workspace.getLeavesOfType(NODE_FILE_VIEW)) {
    const view = leaf.getViewState()
    const parsed = NodePathTabSchema.safeParse(view.state)
    const tab = parsed.success ? parsed.data : undefined
    if (tab?.kind !== 'file' || !sameFolder(tab.target, target)) continue
    const path = tab.path
    const taken = started.sources.find((s) => s !== source && s.path === path)
    if (taken)
      await leaf.setViewState({ ...view, state: { ...tab, debug: debugOf(taken.source_id) } })
  }
  if (source)
    await openNodePathTab(
      workspace,
      {
        kind: 'file',
        target,
        path: source.path,
        debug: debugOf(source.source_id),
      },
      Platform.isMobile
    )
}

export async function startProgram(
  presenter: DebugOwner,
  program: string,
  sources: string[],
  target: PathTarget,
  show: (sessionId: string) => Promise<void>,
  carry: CarriedPoint[] = [],
  argv: string[] = [],
  options: { npmScript?: string; source?: string; stopOnEntry?: boolean } = {}
) {
  argv = [...argv]
  const client = presenter.connection.client
  const service = DebuggerService.instance
  const supportsStop =
    options.stopOnEntry !== undefined &&
    debuggerAcceptanceCapabilities(await client.describe?.()).launch_stop_on_entry
  const started = StartResultSchema.parse(
    await client
      .request('debugger.v1.start', {
        operation_id: crypto.randomUUID(),
        ...debugOwnerParams(presenter),
        program,
        argv,
        ...(supportsStop ? { stop_on_entry: carry.length ? true : options.stopOnEntry } : {}),
        ...(options.npmScript ? { npm_script: options.npmScript } : {}),
        sources: sources.filter((s) => s !== program),
      })
      .catch((error) => {
        // A lost start reply can leave a retained (even already finished) session on the node.
        // Discover it by reading; never send the launch a second time.
        void service
          .discover(presenter)
          .catch((failure) =>
            console.debug('[debugger] Launch outcome could not be discovered', failure)
          )
        throw error
      })
  )
  // The node answers with the session the program's code runs in, not the adapter's own.
  const sessionId = started.debug_session_id
  console.debug('[debugger] Program started', program, sessionId)
  service.trackFolder(presenter, sessionId, target)
  // The node has no restart of its own: Restart in the panel stops the program still going and
  // starts the same one again, with the points it had.
  const binding = service.binding(presenter, sessionId)
  binding.reattach = undefined
  binding.rerun = async () => {
    await presenter.connection.connect()
    // Recover current state before deciding whether the old process needs stopping.
    if (!binding.controller.current && binding.sessionId) await binding.open(binding.sessionId)
    if (!binding.controller.current) throw new Error('Reconnect to the debugger before restarting')
    const carried = carriedPoints(binding)
    if (binding.controller.session.status !== 'exited') await binding.controller.command('stop')
    if (binding.controller.session.status !== 'exited')
      throw new Error('The previous program has not stopped; reconnect before restarting')
    const taken = [...sources, ...service.takenFiles(binding), ...carried.map((c) => c.path)]
    return startProgram(
      presenter,
      program,
      [...new Set(taken)],
      target,
      show,
      carried,
      argv,
      options
    )
  }
  // Finish admitting the source before the controls become available. A late file admission
  // would otherwise replace a location the person already selected in the debugger.
  try {
    const snapshot = await registerSources(presenter, started, target)
    await openSources(presenter, started, snapshot.incarnation, target, options.source ?? program)
  } catch (error) {
    // The start already succeeded. Failure to read or navigate source is not launch failure.
    console.debug('[debugger] Started program source unavailable', sessionId, error)
    binding.fail(error)
  }
  await show(sessionId)
  // Held on its first line, the new run takes the points before any of its code runs. The node
  // can answer the start before that stop reaches the panel, and a point sent meanwhile names
  // a state the program has already left: the node refuses it and the run goes on without it.
  if (carry.length) await untilHeld(binding)
  for (const c of carry) {
    const sourceId = started.sources.find((s) => s.path === c.path)?.source_id
    if (!sourceId) {
      console.debug('[debugger] Point not carried: the node did not take its file', c)
      continue
    }
    if (c.take && binding.trace) {
      await binding.trace.savePoint(sourceId, c.line, {
        take: c.take,
        ...(c.condition ? { when: c.condition } : {}),
        ...(c.note ? { note: c.note } : {}),
        ...(c.enabled !== undefined ? { enabled: c.enabled } : {}),
        ...(c.hit_condition ? { hitCondition: c.hit_condition } : {}),
      })
    } else if (c.log_message || c.hit_condition || c.enabled === false)
      await binding.controller.setBreakpoint(crypto.randomUUID(), sourceId, c.line, c.condition, {
        ...(c.log_message ? { log_message: c.log_message } : {}),
        ...(c.hit_condition ? { hit_condition: c.hit_condition } : {}),
        ...(c.enabled !== undefined ? { enabled: c.enabled } : {}),
      })
    else await binding.controller.setBreakpoint(crypto.randomUUID(), sourceId, c.line, c.condition)
  }
  if (
    supportsStop &&
    options.stopOnEntry === false &&
    carry.length &&
    binding.controller.session.status === 'paused' &&
    binding.controller.snapshot?.threads.some((t) => t.stop?.reason === 'entry')
  )
    await binding.controller.command('continue')
  return sessionId
}

/**
 * What to run, picked the way the node picks a folder: the JavaScript files open from this chat's
 * folder first, and whatever path is typed as the top row, so a file not open runs as well.
 */
export class ProgramPicker extends NodeSuggestModal {
  getSuggestions(query: string): NodeSuggestion[] {
    const typed = query.trim()
    const open = super.getSuggestions(query)
    return typed && !open.some((i) => i.title === typed)
      ? [{ id: typed, icon: 'play', kind: t('debug.pathKind'), title: typed }, ...open]
      : open
  }
}

/** Asks which program to run, offering the JavaScript files open from this chat's folder. */
export async function askAndStartProgram(
  presenter: DebugOwner,
  show: (sessionId: string) => Promise<void>
) {
  const failed = (e: Error | string) => {
    console.debug('[debugger] Program not started', e)
    new Notice(
      e instanceof Error && e.message.includes('debugger_profile_unavailable')
        ? t('streamC.fa5e5929ce988f89')
        : t('streamC.c23252f0ba8471da', { v1: String(e instanceof Error ? e.message : String(e)) })
    )
  }
  try {
    await presenter.connection.connect()
    const target = await chatTarget(presenter)
    if (!target) {
      new Notice(t('streamC.6bfa573c9d1f5727'))
      return
    }
    const app = GlobalStore.getInstance().app
    const open = openFilesOf(app.workspace, target)
    const targets = await programLaunchTargets(
      presenter.connection.client,
      debugOwnerParams(presenter)
    )
    const supportsStop = debuggerAcceptanceCapabilities(
      await presenter.connection.client.describe?.()
    ).launch_stop_on_entry
    const launch = (program: string) => {
      const argumentsKey = (path: string) =>
        `abele-debug-launch-arguments:${JSON.stringify([target.registrationId, target.nodeId, target.kind, target.id, path])}`
      openComponentDialog(() => ProgramLaunchDialog, {
        program,
        stopOnEntrySupported: supportsStop,
        argumentsFor: (path: string) => {
          const saved: unknown = app.loadLocalStorage(argumentsKey(path))
          return typeof saved === 'string' ? saved : ''
        },
        rememberArguments: (path: string, text: string) =>
          app.saveLocalStorage(argumentsKey(path), text),
        launch: (path: string, argv: string[], stopOnEntry?: boolean) => {
          const selected = resolveLaunchTarget(path, targets)
          return startProgram(
            presenter,
            selected.program,
            [...new Set([...open, ...selected.sources])],
            target,
            show,
            [],
            argv,
            { npmScript: selected.npm_script, source: selected.sources[0], stopOnEntry }
          )
        },
      })
    }
    let paths: string[] | undefined
    try {
      paths = await programFiles(presenter.connection.client, target, open)
    } catch (error) {
      // Older nodes may lack filename search. Keep their typed-path picker available.
      if (!(error instanceof Error) || !/unsupported_method|not.*function/i.test(error.message))
        throw error
      console.debug('[debugger] Filename search unavailable; using open files', error)
    }
    if (paths || targets.length) {
      paths = programLaunchPaths(targets, paths ?? [])
      const selected = await pickProgram(
        app,
        paths,
        open,
        t('debug.entryPlaceholder'),
        t('debug.entryEmpty'),
        t('streamC.6b612edc8f9e8b34')
      )
      if (selected) launch(selected)
      return
    }
    const offered = open
      .filter((path) => RUNNABLE.test(path))
      .map((path) => ({
        id: path,
        icon: 'file-code',
        kind: t('streamC.6f3a857852cf96a8'),
        title: path,
        ...(path === defaultProgram(open) ? { note: t('streamC.6b612edc8f9e8b34') } : {}),
      }))
    new ProgramPicker(
      app,
      offered,
      t('debug.programPlaceholder'),
      (item) => launch(item.id),
      t('debug.programEmpty')
    ).open()
  } catch (e) {
    failed(e as Error)
  }
}
