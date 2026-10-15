/** Obsidian pickers and delivery for the human editor. */
import { Notice, TextComponent, TFile, type App, type TFolder } from 'obsidian'
import { ShellModal } from '../modal/ShellModal'
import { pickAnyFile } from '../helpers/suggesters/VaultFilePicker'
import { canvasPath, ObsidianCanvasStore } from './obsidianStore'
import { emptyCanvas } from './core/model'
import { openCanvas } from './opening'
import { CanvasEditor } from './Editor'
import type { CanvasDocument } from './documentRegistry'
import type { CanvasViewer } from './Viewer'

class CanvasInputModal extends ShellModal {
  private resolve: (value: string | null) => void = () => {}
  private value: string | null = null
  constructor(
    app: App,
    title: string,
    label: string,
    private readonly validate: (value: string) => string
  ) {
    super(app, { title, footer: true, cls: ['abele-canvas-input'] })
    const field = new TextComponent(this.bodyEl).setPlaceholder(label)
    field.inputEl.setAttribute('aria-label', label)
    const error = this.bodyEl.createEl('p', { cls: 'mod-warning' })
    this.addButton('Cancel', () => this.close())
    const accept = () => {
      try {
        this.value = this.validate(field.getValue().trim())
        this.close()
      } catch (cause) {
        error.setText(String(cause))
      }
    }
    this.addButton('Create', accept, { cta: true })
    field.inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        accept()
      }
    })
  }
  pick(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolve = resolve
      this.open()
    })
  }
  close(): void {
    this.resolve(this.value)
    super.close()
  }
}
class CanvasChoiceModal<T extends string> extends ShellModal {
  private resolve: (value: T | null) => void = () => {}
  private choice: T | null = null
  constructor(app: App, title: string, description: string, choices: [T, string][]) {
    super(app, { title, footer: true, cls: ['abele-canvas-choice'] })
    this.bodyEl.createEl('p', { text: description })
    for (const [value, label] of choices)
      this.addButton(
        label,
        () => {
          this.choice = value
          this.close()
        },
        { warning: value === 'discard' }
      )
  }
  pick(): Promise<T | null> {
    return new Promise((resolve) => {
      this.resolve = resolve
      this.open()
    })
  }
  close(): void {
    this.resolve(this.choice)
    super.close()
  }
}
/** The moment as Obsidian stamps a pasted picture's name: 20260102030405. */
const stamp = (now = new Date()): string =>
  [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n, i) => String(n).padStart(i ? 2 : 4, '0'))
    .join('')
export function hostCanvasEditor(
  app: App,
  viewer: CanvasViewer,
  current: () => CanvasDocument | null
): CanvasEditor {
  const store = new ObsidianCanvasStore(app)
  return new CanvasEditor(viewer, {
    document: current,
    publish: (document) => store.publishDraft((document as CanvasDocument).file),
    pickFile: async () => (await pickAnyFile(app))?.path ?? null,
    pickLink: () =>
      new CanvasInputModal(app, 'Add canvas link', 'Web address', (value) => {
        const url = new URL(value)
        if (!['http:', 'https:'].includes(url.protocol))
          throw new Error('Use an HTTP or HTTPS address')
        return url.href
      }).pick(),
    confirmDiscard: async () =>
      (await new CanvasChoiceModal(
        app,
        'Discard local canvas draft?',
        'This forgets only unsaved work in this running session. The saved canvas file is not changed.',
        [
          ['stay', 'Keep draft'],
          ['discard', 'Discard local draft'],
        ]
      ).pick()) === 'discard',
    handoffChoice: async () =>
      (await new CanvasChoiceModal<'stay' | 'retain' | 'discard'>(
        app,
        'Open native Canvas with pending work?',
        'Pending work is not saved. Keep it in memory while opening the saved canvas in the native editor, or explicitly discard it. Retained work can be lost on reload or crash; native changes will block retry.',
        [
          ['stay', 'Stay in Abele'],
          ['retain', 'Retain draft and open native'],
          ['discard', 'Discard draft and open native'],
        ]
      ).pick()) ?? 'stay',
    notice: (message) => {
      new Notice(message)
    },
    saveFiles: async (files) => {
      const canvas = requireDocument().file.path,
        out: { path: string; width?: number; height?: number }[] = []
      for (const file of files) {
        // A picture from the clipboard comes unnamed; Obsidian names its own pasted pictures so.
        const ext = file.name.includes('.')
          ? file.name.split('.').pop()!
          : (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')
        const name =
          !file.name || /^image\.\w+$/i.test(file.name)
            ? `Pasted image ${stamp()}.${ext}`
            : file.name
        const path = await app.fileManager.getAvailablePathForAttachment(name, canvas)
        const made = await app.vault.createBinary(path, await file.arrayBuffer())
        let size: { width?: number; height?: number } = {}
        if (file.type.startsWith('image/') && typeof createImageBitmap === 'function')
          try {
            const bitmap = await createImageBitmap(file)
            size = { width: bitmap.width, height: bitmap.height }
            bitmap.close()
          } catch {
            /* A picture the browser cannot read stands at a note's size. */
          }
        out.push({ path: made.path, ...size })
      }
      return out
    },
  })
}
export async function newCanvas(app: App, folder?: TFolder): Promise<void> {
  const name = await new CanvasInputModal(app, 'New Abele canvas', 'Canvas name', (value) => {
    if (!value || value.includes('/')) throw new Error('Enter a canvas name without folders')
    return canvasPath(value.endsWith('.canvas') ? value : `${value}.canvas`)
  }).pick()
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
