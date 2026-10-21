import { t } from '@/i18n'
// Attaching the debugger to a Node.js program already running on the node's machine: the node
// lists what waits for a debugger on loopback, the owner picks one, and the session opens in the
// Debug panel as a started program's does. Detaching leaves the program running.
import { Notice } from 'obsidian'
import { z } from 'zod'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { debugOwnerParams, isFolderOwner, type DebugOwner } from './owner'
import { NodeSuggestModal, type NodeSuggestion } from '@/components/nodeWork/NodeSuggestModal'
import { GlobalStore } from '@/stores/GlobalStore'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { DebuggerService } from './DebuggerService'
import { restoreBreakpoint } from './restoreBreakpoint'
import { debuggerAcceptanceCapabilities } from '@/node/acceptanceCapabilities'
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
export function programSuggestions(
  programs: WaitingProgram[],
  folderOwned = false
): NodeSuggestion[] {
  return programs.map((p) => {
    const where = p.in_chat_folder
      ? folderOwned
        ? t('debug.thisFolder')
        : t('streamC.a54b7b8a7606db01')
      : p.project
        ? t('streamC.22573c4be7ad1c95', { v1: lastPart(p.project.path) })
        : p.cwd
          ? shortPath(p.cwd)
          : t('streamC.81c7eebe9413d3cf')
    return {
      id: `${p.pid}:${p.port}`,
      icon: p.in_chat_folder ? 'plug' : 'folder-output',
      kind: p.in_chat_folder
        ? folderOwned
          ? t('debug.insideFolder')
          : t('streamC.3c5da2fc19b842c2')
        : folderOwned
          ? t('debug.outsideFolder')
          : t('streamC.dfd5c6aac1c2399b'),
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
  presenter: DebugOwner,
  program: WaitingProgram,
  show: (sessionId: string) => Promise<void>,
  outsideFolder = false
) {
  const target = await chatTarget(presenter)
  if (!target) throw new Error('This chat has no folder')
  const { workspace } = GlobalStore.getInstance().app
  const open = openFilesOf(workspace, target)
  const service = DebuggerService.instance
  const attachmentKey = bytesToHex(
    sha256(new TextEncoder().encode(JSON.stringify([program.cwd, program.port, program.script])))
  )
  const previous = service.forAttachment(presenter, attachmentKey)
  const watches =
    previous?.controller.session.watches.map((watch) => ({
      expression: watch.expression,
      stale: true,
    })) ?? []
  const carry = (previous?.retainedBreakpoints ?? []).filter(
    (point) => point.file && point.file !== point.sourceId
  )
  const recordPoints = [...(previous?.trace?.points ?? [])]
  const nodeRestores = debuggerAcceptanceCapabilities(
    await presenter.connection.client.describe?.()
  ).attach_breakpoint_restore
  const started = StartResultSchema.parse(
    await presenter.connection.client.request('debugger.v1.attachProgram', {
      operation_id: crypto.randomUUID(),
      ...debugOwnerParams(presenter),
      pid: program.pid,
      port: program.port,
      sources: [...new Set([...open, ...carry.map((point) => point.file)])],
      outside_folder: outsideFolder,
    })
  )
  console.debug('[debugger] Attached', program.pid, program.port, started.debug_session_id)
  const snapshot = await registerSources(presenter, started, target)
  // Nothing to restart: the node did not start it, and Detach leaves it running.
  const binding = DebuggerService.instance.binding(presenter, started.debug_session_id)
  binding.attachmentKey = attachmentKey
  binding.rerun = undefined
  binding.reattach = () => askAndAttachProgram(presenter, show)
  // Prefer mapped source. Check the ordinary file API before opening an adapter-provided
  // path: ignored build outputs can be admitted for debugging but refused by file browsing.
  const main =
    started.sources.find((source) => /\.[cm]?tsx?$/.test(source.path)) ?? started.sources[0]
  const readable = new Set(open)
  if (main && !readable.has(main.path)) {
    try {
      const client = presenter.connection.client
      const blob =
        target.kind === 'workspace'
          ? await client.readFile(target.id, main.path)
          : await client.repository.blob({
              worktree_id: target.id,
              revision: (await client.repository.observe({ worktree_id: target.id })).revision,
              path: main.path,
            })
      if (blob.content_id && !blob.binary) readable.add(main.path)
    } catch (error) {
      console.debug('[debugger] Attach entry is not a readable source', main.path, error)
    }
  }
  // Only navigate to files already readable in the folder. An adapter's entry can be an
  // ignored build output; source admission alone does not make it a readable file tab.
  await openSources(
    presenter,
    { ...started, sources: started.sources.filter((source) => readable.has(source.path)) },
    snapshot.incarnation,
    target,
    main && readable.has(main.path) ? main.path : chatPath(program, open)
  )
  await show(started.debug_session_id)
  binding.controller.session.watches = watches
  ++binding.revision.value
  for (const point of carry) {
    const source = started.sources.find((source) => source.path === point.file)
    if (!source) continue
    const record = recordPoints.find((record) => record.breakpoint_id === point.id)
    if (record && binding.trace) {
      await binding.trace.savePoint(source.source_id, point.requestedLine, {
        take: record.take,
        ...(point.condition ? { when: point.condition } : {}),
        ...(record.note ? { note: record.note } : {}),
      })
    } else if (!nodeRestores) await restoreBreakpoint(binding.controller, source.source_id, point)
  }
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
  presenter: DebugOwner,
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
        ...debugOwnerParams(presenter),
      })
    )
    console.debug('[debugger] Programs waiting for a debugger', programs.length)
    const app = GlobalStore.getInstance().app
    const byId = new Map(programs.map((p) => [`${p.pid}:${p.port}`, p]))
    new NodeSuggestModal(
      app,
      programSuggestions(programs, isFolderOwner(presenter)),
      t('streamC.b5f49b30dbe29380'),
      (item) => {
        const program = byId.get(item.id)
        if (!program) return
        void (async () => {
          if (!program.in_chat_folder) {
            const yes = await confirmDialog({
              title: isFolderOwner(presenter)
                ? t('debug.outsideTitle')
                : t('streamC.e49e9a0569c8f926'),
              message: isFolderOwner(presenter)
                ? t('debug.outsideMessage', {
                    command: program.command,
                    path: program.cwd ?? t('streamC.323ca97e9290d6b0'),
                  })
                : t('streamC.c87c48a5c3813f55', {
                    v1: program.command,
                    v2: program.cwd ?? t('streamC.323ca97e9290d6b0'),
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
