// What the debugger's panel and a source's margin do about recording: menus, the runs folder,
// the record point editor's moves. The panel and the margin stay presentational; this is their host.
import { Menu, Notice } from 'obsidian'
import { confirmDialog, promptDialog } from '@/components/obsidian/dialogs'
import { GlobalStore } from '@/stores/GlobalStore'
import type { DebuggerBinding } from '../DebuggerService'
import { openTraceRun } from './TraceTabs'
import type { PointEdit } from './TraceSession'

const app = () => GlobalStore.getInstance().app
const fail = (e: unknown) =>
  new Notice(e instanceof Error ? e.message : 'The node did not take the change')

/** Before the first record point of a project: where its runs go on the node's disk. */
async function askFolderOnce(binding: DebuggerBinding) {
  const trace = binding.trace
  if (!trace?.status || trace.status.chosen || trace.runs.length) return
  const folder = await promptDialog({
    title: 'Where to keep recorded runs',
    placeholder: trace.status.folder,
    value: trace.status.folder,
    submitText: 'Keep them here',
  })
  if (folder) await trace.chooseFolder(folder)
}

export async function savePoint(
  binding: DebuggerBinding,
  sourceId: string,
  line: number,
  edit: PointEdit
) {
  const trace = binding.trace
  if (!trace) return
  try {
    await askFolderOnce(binding)
    await trace.savePoint(sourceId, line, edit)
  } catch (e) {
    fail(e)
  }
}

/** The margin's right-click: what can go on this line, or be done with what is there. */
export function marginMenu(
  binding: DebuggerBinding,
  sourceId: string,
  line: number,
  event: MouseEvent,
  edit: (line: number) => void
) {
  const trace = binding.trace
  const known = binding.controller
    .knownBreakpoints()
    .find((b) => b.sourceId === sourceId && b.line === line)
  const record = trace?.pointAt(sourceId, line)
  const menu = new Menu()
  if (!known) {
    menu.addItem((i) =>
      i
        .setTitle('Add breakpoint')
        .setIcon('circle')
        .onClick(() => void binding.controller.toggleBreakpoint(sourceId, line).catch(fail))
    )
    if (trace)
      menu.addItem((i) =>
        i
          .setTitle('Add record point')
          .setIcon('diamond')
          .onClick(() => edit(line))
      )
  } else if (record && trace) {
    menu.addItem((i) =>
      i
        .setTitle('Edit')
        .setIcon('pencil')
        .onClick(() => edit(line))
    )
    menu.addItem((i) =>
      i
        .setTitle('Make it a breakpoint')
        .setIcon('circle')
        .onClick(() => void trace.toBreakpoint(record.id).catch(fail))
    )
    menu.addItem((i) =>
      i
        .setTitle('Remove')
        .setIcon('trash-2')
        .onClick(() => void trace.removePoint(record.id).catch(fail))
    )
  } else {
    if (trace)
      menu.addItem((i) =>
        i
          .setTitle('Make it a record point')
          .setIcon('diamond')
          .onClick(() => edit(line))
      )
    menu.addItem((i) =>
      i
        .setTitle('Remove breakpoint')
        .setIcon('trash-2')
        .onClick(() => void binding.controller.removeBreakpoint(known.id).catch(fail))
    )
  }
  menu.showAtMouseEvent(event)
}

/** Opens a run in its tab; given a record point, at the last step that point gave. */
export function openRun(binding: DebuggerBinding, runId: string, point?: string) {
  const trace = binding.trace
  if (!trace?.projectId) return
  const name = trace.runs.find((r) => r.id === runId)?.name
  void openTraceRun(
    {
      registrationId: binding.registrationId,
      projectId: trace.projectId,
      runId,
      ...(name ? { name } : {}),
    },
    point ? { point } : {}
  ).catch(fail)
}

export function runMenu(binding: DebuggerBinding, runId: string, event: MouseEvent) {
  const trace = binding.trace
  const project = trace?.projectId
  const run = trace?.runs.find((r) => r.id === runId)
  if (!trace || !project || !run) return
  const menu = new Menu()
  menu.addItem((i) =>
    i
      .setTitle('Rename')
      .setIcon('pencil')
      .onClick(async () => {
        const name = await promptDialog({
          title: 'Rename the run',
          value: run.name,
          submitText: 'Rename',
        })
        if (name)
          await trace.rpc
            .rename(project, runId, name)
            .then(() => trace.refresh())
            .catch(fail)
      })
  )
  menu.addItem((i) =>
    i
      .setTitle('Copy where it is on disk')
      .setIcon('copy')
      .onClick(() => void navigator.clipboard.writeText(`${trace.folder}/${runId}`).catch(fail))
  )
  menu.addSeparator()
  menu.addItem((i) =>
    i
      .setTitle('Delete')
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(async () => {
        const sure = await confirmDialog({
          title: 'Delete the run',
          message: `“${run.name}” and every value it took are deleted from the node’s disk. Notes about it stay, their links lead nowhere.`,
        })
        if (sure)
          await trace.rpc
            .remove(project, runId)
            .then(() => trace.refresh())
            .catch(fail)
      })
  )
  menu.showAtMouseEvent(event)
}

/** The runs folder row: where runs go, and changing it. */
export async function folderMenu(binding: DebuggerBinding) {
  const trace = binding.trace
  if (!trace) return
  const folder = await promptDialog({
    title: 'Where to keep recorded runs',
    value: trace.folder,
    submitText: 'Keep them here',
  })
  if (folder && folder !== trace.folder) await trace.chooseFolder(folder).catch(fail)
}

export function browserMenu(event: MouseEvent) {
  const menu = new Menu()
  menu.addItem((i) =>
    i
      .setTitle("The browser's requests are not recorded yet: only the code is")
      .setIcon('globe')
      .setDisabled(true)
  )
  menu.showAtMouseEvent(event)
}

/** Names a line of code offers to take: identifiers on it, keywords left out. */
export function namesOnLine(text: string, line: number): string[] {
  const code = text.split('\n')[line - 1] ?? ''
  const keywords = new Set(
    'const let var function return if else for while do switch case break continue new this typeof instanceof in of await async import export from default class extends super try catch finally throw true false null undefined void delete yield static get set as'.split(
      ' '
    )
  )
  const out: string[] = []
  for (const m of code
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '')
    .replace(/\/\/.*$/, '')
    .matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)) {
    const name = m[0]
    if (!keywords.has(name) && !out.includes(name)) out.push(name)
    if (out.length >= 8) break
  }
  return out
}
