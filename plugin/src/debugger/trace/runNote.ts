import { t } from '@/i18n'
// Writes the note about a run into the folder the settings name, in the vault or anywhere on this
// computer, and opens it. A note already there is left alone: a new one is made next to it.
import { Notice, TFile } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { NodeService } from '@/node/NodeService'
import { buildRunNote, NOTE_STEPS, traceLink, type NoteValue } from './note'
import type { TraceRunState } from './TraceTabs'
import { TraceRpc } from './wire'
import { saveRunNote } from './notesFolder'
import { runName } from './mapping'

const HEAD_LINES = 12

export async function readForNote(rpc: TraceRpc, state: TraceRunState) {
  const run = await rpc.wholeRun(state.projectId, state.runId)
  const values = new Map<string, NoteValue>()
  for (const s of run.steps.slice(0, NOTE_STEPS))
    for (const v of s.values) {
      if (v.failed || v.masked || v.same) continue
      try {
        const shape = await rpc.value(state.projectId, state.runId, s.id, v.name, 'shape', {
          cap: 'agent',
        })
        const page = await rpc.value(state.projectId, state.runId, s.id, v.name, 'page', {
          cap: 'agent',
        })
        values.set(`${s.id}/${v.name}`, {
          ...(shape.shape ? { shape: shape.shape } : {}),
          head: page.page?.lines.slice(0, HEAD_LINES) ?? [],
        })
      } catch (e) {
        console.debug('[trace] Value left out of the note', v.name, e)
      }
    }
  return { run, values }
}

const safeName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Run'

const pendingNotes = new Map<string, Promise<string>>()

export function writeRunNote(state: TraceRunState, rpc?: TraceRpc): Promise<string> {
  const key = JSON.stringify([state.registrationId, state.projectId, state.runId])
  const existing = pendingNotes.get(key)
  if (existing !== undefined) return existing
  const notice = new Notice(t('debug.writingRunNote'), 0)
  const pending = writeNote(state, rpc).finally(() => {
    pendingNotes.delete(key)
    notice.hide()
  })
  pendingNotes.set(key, pending)
  return pending
}

async function writeNote(state: TraceRunState, rpc?: TraceRpc): Promise<string> {
  const connection = NodeService.getInstance().connection(state.registrationId)
  rpc ??= new TraceRpc(async (method, params) => {
    await connection.connect()
    return connection.client.request(method, params)
  })
  const { run, values } = await readForNote(rpc, state)
  const text = buildRunNote({
    run,
    values,
    link: (t) => traceLink({ ...state, ...t }),
  })
  const app = GlobalStore.getInstance().app
  const { path, outside } = await saveRunNote(
    app,
    AbeleConfig.getInstance().traceNotesFolder,
    safeName(runName(run.run)),
    text
  )
  // A note outside the vault cannot open in a tab; the notice says where it is.
  if (!outside) {
    const file = app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) await app.workspace.getLeaf('tab').openFile(file)
  }
  new Notice(t('streamC.3cb5b7a0491d2a70', { v1: String(path) }))
  return path
}
