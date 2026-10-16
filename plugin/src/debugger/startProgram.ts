// Starting a program of a node chat's folder under the debugger: the node runs it with its own
// Node and holds it on its first line; the program's file opens with its margin, so record points
// and breakpoints go in before it goes on. Files open from the same folder take breakpoints too.
import { Notice, Platform, type Workspace } from 'obsidian'
import { watch } from 'vue'
import { z } from 'zod'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { PathTarget } from '@/node/NodePathModel'
import { readChatBinding } from '@/node/expectedTarget'
import { NODE_FILE_VIEW, NodePathTabSchema, openNodePathTab } from '@/node/nodePathNavigation'
import { NodeSuggestModal, type NodeSuggestion } from '@/components/nodeWork/NodeSuggestModal'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService, type DebuggerBinding } from './DebuggerService'

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
export async function chatTarget(presenter: NodeChatPresenter): Promise<PathTarget | undefined> {
  const binding = await readChatBinding(presenter.connection.client, presenter.reference.sessionId)
  if (!binding) return undefined
  const target = binding.target
  return {
    nodeId: presenter.reference.nodeId,
    registrationId: presenter.reference.registrationId,
    projectId: binding.project_id,
    kind: target.kind,
    id: target.kind === 'worktree' ? target.worktree_id : target.workspace_id,
    ...(binding.incarnation ? { incarnation: binding.incarnation } : {}),
  }
}

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
  presenter: NodeChatPresenter,
  started: StartResult,
  target: PathTarget
) {
  const { snapshot } = StatusSchema.parse(
    await presenter.connection.client.request('debugger.v1.status', {
      debug_session_id: started.debug_session_id,
    })
  )
  for (const s of started.sources)
    DebuggerService.instance.registerSource(
      presenter.reference.registrationId,
      presenter.reference.sessionId,
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
  presenter: NodeChatPresenter,
  started: StartResult,
  incarnation: string,
  target: PathTarget,
  main?: string
) {
  const debugOf = (sourceId: string) => ({
    conversationId: presenter.reference.sessionId,
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
  presenter: NodeChatPresenter,
  program: string,
  sources: string[],
  target: PathTarget,
  show: (sessionId: string) => Promise<void>,
  carry: CarriedPoint[] = []
) {
  const client = presenter.connection.client
  const started = StartResultSchema.parse(
    await client.request('debugger.v1.start', {
      operation_id: crypto.randomUUID(),
      conversation_id: presenter.reference.sessionId,
      program,
      argv: [],
      sources: sources.filter((s) => s !== program),
    })
  )
  // The node answers with the session the program's code runs in, not the adapter's own.
  const sessionId = started.debug_session_id
  console.debug('[debugger] Program started', program, sessionId)
  const snapshot = await registerSources(presenter, started, target)
  const service = DebuggerService.instance
  // The node has no restart of its own: Restart in the panel stops the program still going and
  // starts the same one again, with the points it had.
  const binding = service.binding(presenter)
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
    const taken = [...sources, ...carried.map((c) => c.path)]
    return startProgram(presenter, program, [...new Set(taken)], target, show, carried)
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
    if (c.take && binding.trace)
      await binding.trace.savePoint(sourceId, c.line, {
        take: c.take,
        ...(c.condition ? { when: c.condition } : {}),
        ...(c.note ? { note: c.note } : {}),
      })
    else await binding.controller.setBreakpoint(crypto.randomUUID(), sourceId, c.line, c.condition)
  }
  await openSources(presenter, started, snapshot.incarnation, target, program)
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
      ? [{ id: typed, icon: 'play', kind: "A path in the chat's folder", title: typed }, ...open]
      : open
  }
}

/** Asks which program to run, offering the JavaScript files open from this chat's folder. */
export async function askAndStartProgram(
  presenter: NodeChatPresenter,
  show: (sessionId: string) => Promise<void>
) {
  const failed = (e: Error | string) => {
    console.debug('[debugger] Program not started', e)
    new Notice(
      e instanceof Error && e.message.includes('debugger_profile_unavailable')
        ? 'This node cannot run programs under the debugger yet: its JavaScript debugger is not installed.'
        : `The program did not start: ${e instanceof Error ? e.message : String(e)}`
    )
  }
  try {
    await presenter.connection.connect()
    const target = await chatTarget(presenter)
    if (!target) {
      new Notice('This chat has no folder to run a program from')
      return
    }
    const app = GlobalStore.getInstance().app
    const open = openFilesOf(app.workspace, target)
    const offered = open
      .filter((path) => RUNNABLE.test(path))
      .map((path) => ({
        id: path,
        icon: 'file-code',
        kind: 'Open in a tab',
        title: path,
        ...(path === defaultProgram(open) ? { note: 'Looked at last' } : {}),
      }))
    new ProgramPicker(
      app,
      offered,
      'A JavaScript file to run under the debugger: src/main.js',
      (item) => void startProgram(presenter, item.id, open, target, show).catch(failed),
      "Type the path of a JavaScript file in this chat's folder"
    ).open()
  } catch (e) {
    failed(e as Error)
  }
}
