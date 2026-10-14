// Starting a program of a node chat's folder under the debugger: the node runs it with its own
// Node and holds it on its first line; the program's file opens with its margin, so record points
// and breakpoints go in before it goes on. Files open from the same folder take breakpoints too.
import { Notice, Platform, type Workspace } from 'obsidian'
import { z } from 'zod'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { PathTarget } from '@/node/NodePathModel'
import { readChatBinding } from '@/node/expectedTarget'
import { NODE_FILE_VIEW, NodePathTabSchema, openNodePathTab } from '@/node/nodePathNavigation'
import { askName } from '@/modal/askName'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService } from './DebuggerService'

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
      state.data.target.registrationId === target.registrationId &&
      state.data.target.kind === target.kind &&
      state.data.target.id === target.id &&
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

export async function startProgram(
  presenter: NodeChatPresenter,
  program: string,
  sources: string[],
  target: PathTarget,
  show: (sessionId: string) => Promise<void>
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
      snapshot.incarnation
    )
  await show(sessionId)
  const source = started.sources.find((s) => s.path === program) ?? started.sources[0]
  if (source)
    await openNodePathTab(
      GlobalStore.getInstance().app.workspace,
      {
        kind: 'file',
        target,
        path: source.path,
        debug: {
          conversationId: presenter.reference.sessionId,
          sourceId: source.source_id,
          debugSessionId: sessionId,
          incarnation: snapshot.incarnation,
        },
      },
      Platform.isMobile
    )
  return sessionId
}

/** Asks which program to run, offering the JavaScript file open from this chat's folder. */
export async function askAndStartProgram(
  presenter: NodeChatPresenter,
  show: (sessionId: string) => Promise<void>
) {
  try {
    await presenter.connection.connect()
    const target = await chatTarget(presenter)
    if (!target) {
      new Notice('This chat has no folder to run a program from')
      return
    }
    const app = GlobalStore.getInstance().app
    const open = openFilesOf(app.workspace, target)
    const program = (
      await askName(app, {
        title: 'Run a program under the debugger',
        placeholder: 'src/main.js',
        value: defaultProgram(open),
        submitText: 'Run',
      })
    )?.trim()
    if (!program) return
    await startProgram(presenter, program, open, target, show)
  } catch (e) {
    console.debug('[debugger] Program not started', e)
    new Notice(
      e instanceof Error && e.message.includes('debugger_profile_unavailable')
        ? 'This node cannot run programs under the debugger yet: its JavaScript debugger is not installed.'
        : `The program did not start: ${e instanceof Error ? e.message : String(e)}`
    )
  }
}
