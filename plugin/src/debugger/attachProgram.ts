import { t } from '@/i18n'
// Attaching the debugger to a Node.js program already running on the node's machine: the node
// lists what waits for a debugger on loopback, the owner picks one, and the session opens in the
// Debug panel as a started program's does. Detaching leaves the program running.
import { Notice } from 'obsidian'
import { z } from 'zod'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { NodeSuggestModal, type NodeSuggestion } from '@/components/nodeWork/NodeSuggestModal'
import { GlobalStore } from '@/stores/GlobalStore'
import { confirmDialog } from '@/components/obsidian/dialogs'
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

/** A long folder by its last two names: the confirmation names it in full. */
const shortPath = (path: string) => {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : path
}
const lastPart = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/** One row per program: its command, then where it runs, its process and its port. */
export function programSuggestions(programs: WaitingProgram[]): NodeSuggestion[] {
  return programs.map((p) => {
    const where = p.in_chat_folder
      ? t('streamC.a54b7b8a7606db01')
      : p.project
        ? t('streamC.22573c4be7ad1c95', { v1: lastPart(p.project.path) })
        : p.cwd
          ? shortPath(p.cwd)
          : t('streamC.81c7eebe9413d3cf')
    return {
      id: `${p.pid}:${p.port}`,
      icon: p.in_chat_folder ? 'plug' : 'folder-output',
      kind: p.in_chat_folder ? t('streamC.3c5da2fc19b842c2') : t('streamC.dfd5c6aac1c2399b'),
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
  const binding = DebuggerService.instance.binding(presenter)
  binding.rerun = undefined
  binding.reattach = () => askAndAttachProgram(presenter, show)
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
      ? t('streamC.acf5135c0244b28e')
      : message.includes('debugger_program_not_found')
        ? t('streamC.84fca3706ad92141')
        : message.includes('unsupported_method')
          ? t('streamC.2d7c3895dbbd8c4c')
          : t('streamC.f266b0b52e1898ac', { v1: String(message) })
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
      new Notice(t('streamC.9d103b53ab67f9eb'))
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
      t('streamC.b5f49b30dbe29380'),
      (item) => {
        const program = byId.get(item.id)
        if (!program) return
        void (async () => {
          if (!program.in_chat_folder) {
            const yes = await confirmDialog({
              title: t('streamC.e49e9a0569c8f926'),
              message: t('streamC.c87c48a5c3813f55', {
                v1: String(program.command),
                v2: String(program.cwd ?? t('streamC.323ca97e9290d6b0')),
              }),
              confirmText: t('streamC.d406ade2958cb5b6'),
              confirmTooltip: t('streamC.f733edcdd847a681'),
            })
            if (!yes) return
          }
          await attachToProgram(presenter, program, show, !program.in_chat_folder)
        })().catch(failed)
      },
      t('streamC.5103d93fe1af444f')
    ).open()
  } catch (e) {
    failed(e)
  }
}
