// Attaching the debugger to a Node.js program already running on the node's machine: the node
// lists what waits for a debugger on loopback, the owner picks one, and the session opens in the
// Debug panel as a started program's does. Detaching leaves the program running.
import { Notice } from 'obsidian'
import { z } from 'zod'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { NodeSuggestModal, type NodeSuggestion } from '@/components/nodeWork/NodeSuggestModal'
import { GlobalStore } from '@/stores/GlobalStore'
import { confirmAction } from '@/modal/confirm'
import { DebuggerService } from './DebuggerService'
import {
  StartResultSchema,
  chatTarget,
  openFilesOf,
  openSources,
  registerSources,
} from './startProgram'

export const ProgramSchema = z.object({
  pid: z.number(),
  port: z.number(),
  command: z.string(),
  cwd: z.string().nullable(),
  script: z.string().nullable(),
  project: z.object({ project_id: z.string(), path: z.string() }).nullable(),
  in_chat_folder: z.boolean(),
})
export type WaitingProgram = z.infer<typeof ProgramSchema>
const ProgramsSchema = z.object({ programs: z.array(ProgramSchema).max(256) })

/** What the picker says when nothing waits: how to start a program so that it does. */
export const NOTHING_WAITS =
  'No Node.js program on this node is waiting for a debugger. Start one with node --inspect app.js and open this again.'

const lastPart = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/** One row per program: its command, then where it runs, its process and its port. */
export function programSuggestions(programs: WaitingProgram[]): NodeSuggestion[] {
  return programs.map((p) => {
    const where = p.in_chat_folder
      ? "This chat's folder"
      : p.project
        ? `Project ${lastPart(p.project.path)}`
        : (p.cwd ?? 'Folder unknown')
    return {
      id: `${p.pid}:${p.port}`,
      icon: p.in_chat_folder ? 'plug' : 'folder-output',
      kind: p.in_chat_folder
        ? "Runs from this chat's folder"
        : "Runs outside this chat's folder: attaching asks first",
      title: p.command,
      note: `${where} · pid ${p.pid} · port ${p.port}`,
    }
  })
}

/** The program's own file as a path in the chat's folder, when it is one. */
function chatPath(program: WaitingProgram, open: string[]) {
  if (!program.in_chat_folder || !program.script) return undefined
  const script = program.script
  return open.find((path) => script.endsWith('/' + path))
}

export async function attachToProgram(
  presenter: NodeChatPresenter,
  program: WaitingProgram,
  show: (sessionId: string) => Promise<void>,
  outsideFolder = false
) {
  const target = await chatTarget(presenter)
  if (!target) throw new Error('This chat has no folder')
  const { workspace } = GlobalStore.getInstance().app
  const open = openFilesOf(workspace, target)
  const started = StartResultSchema.parse(
    await presenter.connection.client.request('debugger.v1.attachProgram', {
      operation_id: crypto.randomUUID(),
      conversation_id: presenter.reference.sessionId,
      pid: program.pid,
      port: program.port,
      sources: open,
      outside_folder: outsideFolder,
    })
  )
  console.debug('[debugger] Attached', program.pid, program.port, started.debug_session_id)
  const snapshot = await registerSources(presenter, started, target)
  // Nothing to restart: the node did not start it, and Detach leaves it running.
  DebuggerService.instance.binding(presenter).rerun = undefined
  await show(started.debug_session_id)
  // The program's own file opens with its margin; with none in the chat's folder, the files open.
  await openSources(
    presenter,
    started,
    snapshot.incarnation,
    target,
    started.sources.find((s) => s.source_id === 's1')?.path ?? chatPath(program, open)
  )
  return started.debug_session_id
}

function failed(e: unknown) {
  console.debug('[debugger] Not attached', e)
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : 'unknown error'
  new Notice(
    message.includes('debugger_profile_unavailable')
      ? 'This node cannot debug programs yet: its JavaScript debugger is not installed.'
      : message.includes('debugger_program_not_found')
        ? 'That program no longer waits for a debugger. Open the list again.'
        : message.includes('unsupported_method')
          ? 'This node cannot attach to running programs. Update it.'
          : `Not attached: ${message}`
  )
}

/** Asks which waiting program to attach to; one outside the chat's folder asks once more. */
export async function askAndAttachProgram(
  presenter: NodeChatPresenter,
  show: (sessionId: string) => Promise<void>
) {
  try {
    await presenter.connection.connect()
    const target = await chatTarget(presenter)
    if (!target) {
      new Notice('This chat has no folder to debug from')
      return
    }
    const { programs } = ProgramsSchema.parse(
      await presenter.connection.client.request('debugger.v1.programs', {
        conversation_id: presenter.reference.sessionId,
      })
    )
    console.debug('[debugger] Programs waiting for a debugger', programs.length)
    const app = GlobalStore.getInstance().app
    const byId = new Map(programs.map((p) => [`${p.pid}:${p.port}`, p]))
    new NodeSuggestModal(
      app,
      programSuggestions(programs),
      'A running Node.js program to attach the debugger to',
      (item) => {
        const program = byId.get(item.id)
        if (!program) return
        void (async () => {
          if (!program.in_chat_folder) {
            const yes = await confirmAction(app, {
              title: 'Attach to a program outside this folder?',
              message: `${program.command} runs from ${program.cwd ?? 'a folder the node cannot name'}, not from this chat's folder. The debugger can pause it and read its values. Detaching later leaves it running.`,
              confirmText: 'Attach',
              confirmTooltip: 'Attach the debugger to this program',
            })
            if (!yes) return
          }
          await attachToProgram(presenter, program, show, !program.in_chat_folder)
        })().catch(failed)
      },
      NOTHING_WAITS
    ).open()
  } catch (e) {
    failed(e)
  }
}
