/** Obsidian pickers and delivery for the human editor. */
import { Notice, TFile, type App, type TFolder } from 'obsidian'
import { choiceDialog, promptDialog } from '@/components/obsidian/dialogs'
import { pickAnyFile } from '../helpers/suggesters/VaultFilePicker'
import { canvasPath, ObsidianCanvasStore } from './obsidianStore'
import { emptyCanvas } from './core/model'
import { openCanvas } from './opening'
import { CanvasEditor } from './Editor'
import type { CanvasDocument } from './documentRegistry'
import type { CanvasViewer } from './Viewer'

/** One line of text for the canvas, kept open with the reason while `validate` refuses it. */
const askCanvasText = (title: string, label: string, validate: (value: string) => string) =>
  promptDialog({
    title,
    placeholder: label,
    label,
    submitText: 'Create',
    validate,
    modalClass: 'abele-canvas-input',
  })
const askCanvasChoice = <T extends string>(
  title: string,
  description: string,
  choices: [T, string][]
) =>
  choiceDialog<T>({
    title,
    message: description,
    choices: choices.map(([value, text]) => ({ value, text, warning: value === 'discard' })),
    modalClass: 'abele-canvas-choice',
  })
/** The moment as Obsidian stamps a pasted picture's name: 20260102030405. */
const stamp = (now = new Date()): string =>
  [
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  ]
    .map((n, i) => String(n).padStart(i ? 2 : 4, '0'))
    .join('')
export function hostCanvasEditor(
  app: App,
  viewer: CanvasViewer,
  current: () => CanvasDocument | null
): CanvasEditor {
  const store = new ObsidianCanvasStore(app)
  const requireDocument = () => {
    const document = current()
    if (!document) throw new Error('Canvas is no longer open')
    return document
  }
  return new CanvasEditor(viewer, {
    document: current,
    publish: (document) => store.publishDraft((document as CanvasDocument).file),
    pickFile: async () => (await pickAnyFile(app))?.path ?? null,
    pickLink: () =>
      askCanvasText('Add canvas link', 'Web address', (value) => {
        const url = new URL(value)
        if (!['http:', 'https:'].includes(url.protocol))
          throw new Error('Use an HTTP or HTTPS address')
        return url.href
      }),
    confirmDiscard: async () =>
      (await askCanvasChoice(
        'Discard local canvas draft?',
        'This forgets only unsaved work in this running session. The saved canvas file is not changed.',
        [
          ['stay', 'Keep draft'],
          ['discard', 'Discard local draft'],
        ]
      )) === 'discard',
    handoffChoice: async () =>
      (await askCanvasChoice<'stay' | 'retain' | 'discard'>(
        'Open native Canvas with pending work?',
        'Pending work is not saved. Keep it in memory while opening the saved canvas in the native editor, or explicitly discard it. Retained work can be lost on reload or crash; native changes will block retry.',
        [
          ['stay', 'Stay in Abele'],
          ['retain', 'Retain draft and open native'],
          ['discard', 'Discard draft and open native'],
        ]
      )) ?? 'stay',
    notice: (message) => {
      new Notice(message)
    },
    saveAttachment: async (name, data) => {
      const path = await app.fileManager.getAvailablePathForAttachment(
        name,
        requireDocument().file.path
      )
      return (await app.vault.createBinary(path, data)).path
    },
    createNote: async (name, text) => {
      const parent = app.fileManager.getNewFileParent(requireDocument().file.path)
      const base = parent.path === '/' ? '' : `${parent.path}/`
      let path = `${base}${name}.md`
      for (let i = 1; app.vault.getAbstractFileByPath(path); i++) path = `${base}${name} ${i}.md`
      return (await app.vault.create(path, text)).path
    },
    noteHeadings: async (path) =>
      (app.metadataCache.getCache(path)?.headings ?? []).map((h) => ({
        heading: h.heading,
        level: h.level,
      })),
    // A file dragged from Obsidian's own file list: Obsidian holds what is being dragged.
    droppedPaths: () => {
      const dragged = (
        app as unknown as {
          dragManager?: { draggable?: { type?: string; file?: TFile; files?: TFile[] } | null }
        }
      ).dragManager?.draggable
      if (dragged?.type === 'file' && dragged.file) return [dragged.file.path]
      if (dragged?.type === 'files' && dragged.files) return dragged.files.map((f) => f.path)
      return []
    },
  })
}
export async function newCanvas(app: App, folder?: TFolder): Promise<void> {
  const name = await askCanvasText('New Abele canvas', 'Canvas name', (value) => {
    if (!value || value.includes('/')) throw new Error('Enter a canvas name without folders')
    return canvasPath(value.endsWith('.canvas') ? value : `${value}.canvas`)
  })
  if (!name) return
  try {
    const parent =
      folder ?? app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? '')
    const path = parent.path === '/' ? name : `${parent.path}/${name}`
    await new ObsidianCanvasStore(app).create(path, emptyCanvas())
    const file = app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) await openCanvas(app, file)
  } catch (error) {
    new Notice(`Canvas could not be created: ${String(error)}`)
  }
}
