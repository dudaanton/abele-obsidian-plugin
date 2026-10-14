// Starting a program of a node chat's folder under the debugger: the node runs it with its own
// Node and holds it on its first line; the program's file opens with its margin, so record points
// and breakpoints go in before it goes on. Files open from the same folder take breakpoints too.
import { Notice, Platform, type Workspace } from 'obsidian'
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
const StatusSchema = z.object({ snapshot: z.object({ incarnation: id }).loose() }).loose()

const RUNNABLE = /\.[cm]?js$/
/** What takes breakpoints: JavaScript as it runs, and TypeScript the node maps through its build. */
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** The chat's folder as a node file tab addresses it; undefined while the chat has none. */
async function chatTarget(presenter: NodeChatPresenter): Promise<PathTarget | undefined> {
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

const sameFolder = (a: PathTarget, b: PathTarget) =>
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
  const { snapshot } = StatusSchema.parse(
    await client.request('debugger.v1.status', { debug_session_id: sessionId })
  )
  const service = DebuggerService.instance
  for (const s of started.sources)
    service.registerSource(
      presenter.reference.registrationId,
      presenter.reference.sessionId,
      s.source_id,
      s.path,
      sessionId,
      snapshot.incarnation,
      target
    )
  // The node has no restart of its own: Restart in the panel stops the program still going and
  // starts the same one again, with the points it had.
  const binding = service.binding(presenter)
  binding.rerun = async () => {
    const carried = carriedPoints(binding)
    if (binding.controller.session.status !== 'exited') await binding.controller.command('stop')
    const taken = [...sources, ...carried.map((c) => c.path)]
    return startProgram(presenter, program, [...new Set(taken)], target, show, carried)
  }
  await show(sessionId)
  // Held on its first line, the new run takes the points before any of its code runs.
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
  const debugOf = (sourceId: string) => ({
    conversationId: presenter.reference.sessionId,
    sourceId,
    debugSessionId: sessionId,
    incarnation: snapshot.incarnation,
  })
  const source = started.sources.find((s) => s.path === program) ?? started.sources[0]
  // The other files the node took, already open from this folder, take their margin where they are.
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
