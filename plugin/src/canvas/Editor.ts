/**
 * Human interaction over the existing shared document. Every change applies in memory at once,
 * one undo step each; writing the file is batched by the write scheduler, later and less often.
 */
import { nanoid } from 'nanoid'
import { editCanvas, type CanvasOperation, type NodeInput } from './core/edit'
import { bounds, canvasFingerprint, parentsOf, SHAPES, type Rect, type Shape } from './core/model'
import { moveIds } from './core/selection'
import { lineBounds, linesOf } from './core/primitives'
import { allInkEntries, inkBounds, inkEntries } from './core/ink'
import { canvasVisibility } from './core/visibility'
import type { CanvasSession, GraphTransform } from './core/session'
import { CanvasSessionError } from './core/session'
import { CanvasWriteScheduler, type CanvasWriteSchedule } from './core/writeScheduler'
import type { CanvasViewer } from './Viewer'
import {
  CanvasInput,
  OPPOSITE,
  type CanvasDouble,
  type CanvasDrop,
  type CanvasInputTool,
} from './input'
import { paintedRoute, routeSamples } from './core/scene'
import { pasteOps, type Pasted } from './paste'
import { toWorld } from '../drawing/camera'
import { WIDTHS } from '../drawing/model'
import { THICKNESSES, type Thickness } from '../ink/thickness'

export interface CanvasEditorDocument {
  session: CanvasSession
  file: { path: string }
  draftPath: string | null
  error: string | null
  recovery: unknown
  state: { native: boolean; conflict: boolean }
  writes: { flush(): Promise<boolean> } | null
  beginDraft(): void
  updateDraft(transform: GraphTransform): void
  finishDraft(): void
  cancelDraft(): void
  undoLocal(): void
  redoLocal(): void
  discardDraft(): void
  releaseWriter(retainPending?: boolean): void
}
export interface CanvasEditorPorts {
  document(): CanvasEditorDocument | null
  /** Writes the document's unwritten human work to its file. */
  publish(document: CanvasEditorDocument): Promise<unknown>
  /** When unwritten work is written; tests shorten it. */
  schedule?: CanvasWriteSchedule
  pickFile(): Promise<string | null>
  pickLink(): Promise<string | null>
  confirmDiscard(): Promise<boolean>
  handoffChoice(): Promise<'stay' | 'retain' | 'discard'>
  notice(message: string): void
  /** Pasted files saved with the vault's attachments: their paths, and a picture's size. */
  saveFiles?(files: File[]): Promise<{ path: string; width?: number; height?: number }[]>
}
/** What is picked, for a bar of actions standing over it. */
export interface CanvasPicked {
  ids: string[]
  kinds: ('text' | 'shape' | 'file' | 'link' | 'group' | 'connection' | 'line' | 'stroke')[]
  /** Around all of it, in the canvas's own units. */
  rect: Rect | null
}
/** Fields the editor reads its next action's values from, by what they hold. */
export type CanvasField =
  | 'ink-color'
  | 'ink-size'
  | 'shape'
  | 'shape-color'
  | 'label'
  | 'from-end'
  | 'to-end'
  | 'routing'
  | 'connection-color'

/** The picked things' actions that need no field of their own. */
export type CanvasAction = 'duplicate' | 'copy' | 'front' | 'back' | 'delete-with-contents'
/** The gap between what is copied and its copy, which stands beside it to the right. */
const COPY_GAP = 40

const FINGER_KEY = 'abele-canvas-finger-draws'
const readFingerDraws = (): boolean => {
  try {
    return window.localStorage?.getItem(FINGER_KEY) === '1'
  } catch {
    return false
  }
}
const writeFingerDraws = (on: boolean): void => {
  try {
    window.localStorage?.setItem(FINGER_KEY, on ? '1' : '0')
  } catch {
    /* A device that keeps nothing simply asks again next time. */
  }
}

export class CanvasEditor {
  private selected = new Set<string>()
  private multiple = false
  private tool: CanvasInputTool = 'select'
  private readonly palette: HTMLElement
  private readonly inkControls: HTMLElement
  private readonly inkSelectionControls: HTMLDetailsElement
  private readonly inkAttachment: HTMLSelectElement
  private readonly inkColor: HTMLSelectElement
  private readonly inkSize: HTMLSelectElement
  private readonly shape: HTMLSelectElement
  private readonly shapeColor: HTMLSelectElement
  private readonly properties: HTMLDetailsElement
  private readonly label: HTMLInputElement
  private readonly fromEnd: HTMLSelectElement
  private readonly toEnd: HTMLSelectElement
  private readonly routing: HTMLSelectElement
  private readonly color: HTMLSelectElement
  private propertyBaseline = ''
  private propertyId = ''
  private readonly inputAdapter: CanvasInput
  private geometry: { document: CanvasEditorDocument; generation: number; path: string } | null =
    null
  private editing: string | null = null
  /** A connection let go over empty canvas, waiting for what to make at its end. */
  private drop: CanvasDrop | null = null
  /** Which of pen and marker the Pencil draws with: the one last taken in hand. */
  private pencilInk: 'pen' | 'marker' = 'pen'
  /** A pen has touched this canvas, so it is a device with a Pencil. */
  private penSeen = false
  /** On a device with a Pencil, whether a finger draws too; kept on this device. */
  private fingerDraws = readFingerDraws()
  /** A frame whose name is being written on its label. */
  private naming: string | null = null
  /** A connection or free line whose label is being written where it stands. */
  private labeling: string | null = null
  /** The tool to go back to when a held Space lets go of the canvas. */
  private spaceFrom: CanvasInputTool | null = null
  /** Where the pointer last was over the canvas, in its own units: where a paste lands. */
  private pointer: { x: number; y: number } | null = null
  private ownedDraft: CanvasEditorDocument | null = null
  /** Strokes drawn while the last change was being written, added one by one after it. */
  private held: CanvasOperation[] = []
  private composing = false
  private waiting = false
  private destroyed = false
  private readonly writes: CanvasWriteScheduler<CanvasEditorDocument>
  /** The last batched write failed with the work still in memory; Retry and Discard show. */
  private writeFailed: CanvasEditorDocument | null = null
  private flushHook: { document: CanvasEditorDocument; flush(): Promise<boolean> } | null = null
  private readonly bar: HTMLElement
  private readonly panel: HTMLElement
  private readonly text: HTMLTextAreaElement
  private readonly status: HTMLElement
  private readonly buttons = new Map<string, HTMLButtonElement>()
  private readonly off: (() => void)[] = []
  private readonly watchers = new Set<() => void>()
  /**
   * The editor as toolbars drawn apart from its own rows of buttons see it: an action is pressed
   * by its label and read back with whether it may run now and whether it is on, so every rule of
   * when an action may run stays here.
   */
  readonly controls = {
    watch: (fn: () => void): (() => void) => {
      this.watchers.add(fn)
      return () => this.watchers.delete(fn)
    },
    tool: (): CanvasInputTool => this.tool,
    state: (label: string) => {
      const b = this.buttons.get(label)
      return b
        ? { disabled: b.disabled, hidden: b.hidden, on: b.getAttribute('aria-pressed') === 'true' }
        : { disabled: true, hidden: true, on: false }
    },
    press: (label: string): void => this.buttons.get(label)?.click(),
    value: (field: CanvasField): string => this.field(field).value,
    set: (field: CanvasField, value: string): void => {
      this.field(field).value = value
      this.refresh()
    },
    picked: (): CanvasPicked => this.picked(),
    editing: (): string | null => this.editing,
    textField: (): HTMLTextAreaElement => this.text,
    /** The frame whose name is being written, so its label opens for writing. */
    naming: (): string | null => this.naming,
    name: (id: string | null): void => {
      this.naming = id
      this.refresh()
    },
    renameFrame: (id: string, label: string): Promise<void> => this.frameOp(id, 'rename', label),
    /** The connection whose label is being written where it stands. */
    labeling: (): string | null => this.labeling,
    editLabel: (id: string | null): void => {
      this.labeling = id
      if (id) this.selected = new Set([id])
      this.refresh()
    },
    /** Writes a connection's label as one step; an unchanged one is left alone. */
    saveLabel: (id: string, label: string): Promise<void> => this.saveLabel(id, label),
    foldFrame: (id: string, collapsed: boolean): Promise<void> =>
      this.frameOp(id, collapsed ? 'collapse' : 'expand'),
    /**
     * What the picked things' "more" menu does: a copy beside them, the canvas's own JSON on the
     * clipboard, stacking, and taking a frame away together with what is inside it.
     */
    act: (action: CanvasAction): Promise<void> => this.act(action),
    /** A text card's place taken by a note, made from its words, in one step. */
    replaceWithNote: (id: string, path: string): Promise<void> => this.replaceWithNote(id, path),
    /** A connection let go over nothing, waiting to be told what to make there. */
    drop: (): CanvasDrop | null => this.drop,
    /** Makes a card, a note or a shape at the end of the dropped connection, or nothing. */
    dropAdd: (kind: 'card' | 'note' | 'shape' | null): Promise<void> => this.dropAdd(kind),
    /** A pen has touched the canvas: the pen's colours stay out for it whatever is in hand. */
    pencil: (): boolean => this.penSeen,
    /** Which of pen and marker the Pencil draws with; pressed, it takes the other. */
    pencilInk: (): 'pen' | 'marker' => this.pencilInk,
    setPencilInk: (ink: 'pen' | 'marker'): void => {
      this.pencilInk = ink
      this.refresh()
    },
    fingerDraws: (): boolean => this.fingerDraws,
    setFingerDraws: (on: boolean): void => {
      this.fingerDraws = on
      writeFingerDraws(on)
      this.refresh()
    },
    /** A card, frame or line is being carried or drawn right now. */
    gesturing: (): boolean => !!this.geometry,
    /** The frame a card being carried would land in. */
    landing: (): string | null => this.inputAdapter.landing(),
  }

  constructor(
    readonly viewer: CanvasViewer,
    private readonly ports: CanvasEditorPorts
  ) {
    this.writes = new CanvasWriteScheduler<CanvasEditorDocument>(
      {
        pending: (document) => this.writable(document),
        write: (document) => {
          console.debug('[abele] canvas: writing batched changes', {
            steps: document.session.pendingSteps,
          })
          return this.ports.publish(document)
        },
        failed: (document, error) => {
          // A local edit begun while the write was being prepared only postpones it.
          if (
            error instanceof CanvasSessionError &&
            (error.code === 'busy' || error.code === 'stale') &&
            !document.session.conflict &&
            !document.session.publicationOutcome
          ) {
            this.writes.changed(document)
            return
          }
          this.writeFailed = document
          this.fail(error)
        },
      },
      {
        set: (run, ms) => viewer.el.ownerDocument.defaultView.setTimeout(run, ms),
        clear: (id) => viewer.el.ownerDocument.defaultView.clearTimeout(id),
      },
      ports.schedule
    )
    const doc = viewer.el.ownerDocument
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
      doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K]
    this.bar = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    this.bar.className = 'abele-canvas-controls abele-canvas-editor-controls'
    this.panel = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    this.panel.className = 'abele-canvas-text-editor'
    this.text = doc.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'textarea'
    ) as HTMLTextAreaElement
    this.text.rows = 4
    this.text.setAttribute('aria-label', 'Canvas card text')
    this.panel.append(this.text)
    this.status = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    this.status.className = 'abele-canvas-status abele-canvas-editor-status'
    this.status.setAttribute('role', 'status')
    viewer.el.insertBefore(this.bar, viewer.stage)
    viewer.el.insertBefore(this.panel, viewer.stage)
    viewer.el.insertBefore(this.status, viewer.stage)
    this.palette = make('div')
    this.palette.className = 'abele-canvas-controls abele-canvas-shape-controls'
    this.palette.hidden = true
    viewer.el.insertBefore(this.palette, viewer.stage)
    this.button('Shapes and connections', 'Shapes and lines', () => {
      this.inputAdapter.cancel()
      this.inkControls.hidden = true
      this.tool = 'select'
      this.palette.hidden = !this.palette.hidden
      this.refresh()
    })
    this.inkControls = make('div')
    this.inkControls.className = 'abele-canvas-controls abele-canvas-shape-controls'
    this.inkControls.hidden = true
    viewer.el.insertBefore(this.inkControls, viewer.stage)
    this.button('Canvas drawing tools', 'Drawing', () => {
      this.inputAdapter.cancel()
      this.inkControls.hidden = !this.inkControls.hidden
      this.palette.hidden = true
      if (this.inkControls.hidden) this.tool = 'select'
      this.refresh()
    })
    for (const [tool, label, text] of [
      ['pan', 'Navigate canvas', 'Navigate'],
      ['pen', 'Draw with pen', 'Pen'],
      ['marker', 'Draw with marker', 'Marker'],
      ['eraser', 'Erase whole strokes', 'Eraser'],
      ['partial-eraser', 'Erase part of strokes', 'Partial eraser'],
      ['lasso', 'Lasso canvas objects', 'Lasso'],
    ] as const)
      this.button(
        label,
        text,
        () => {
          this.inputAdapter.cancel()
          this.selected.clear()
          this.tool = tool
          if (tool === 'pen' || tool === 'marker') this.pencilInk = tool
          this.multiple = false
          this.refresh()
        },
        this.inkControls
      )
    this.inkColor = this.select(this.inkControls, 'Canvas ink color', this.colorOptions())
    this.inkSize = this.select(
      this.inkControls,
      'Canvas ink thickness',
      THICKNESSES.map((t) => [t, t])
    )
    this.inkSize.value = 'medium'
    this.inkSelectionControls = make('details')
    this.inkSelectionControls.className = 'abele-canvas-ink-selection'
    const inkSummary = make('summary')
    inkSummary.textContent = 'Selection actions'
    this.inkSelectionControls.append(inkSummary)
    const inkActions = make('div')
    inkActions.className = 'abele-canvas-controls'
    this.inkSelectionControls.append(inkActions)
    this.inkControls.append(this.inkSelectionControls)
    this.button(
      'Toggle lasso multiple selection',
      'Select multiple',
      () => {
        this.multiple = !this.multiple
        this.refresh()
      },
      inkActions
    )
    this.button('Delete canvas selection', 'Delete', () => this.remove(), inkActions)
    this.button('Group canvas selection', 'Group', () => this.group(), inkActions)
    this.button('Ungroup canvas selection', 'Ungroup', () => this.group(true), inkActions)
    this.button(
      'Recolor canvas selection',
      'Apply color',
      () => this.inkAction('color'),
      inkActions
    )
    this.button('Detach selected ink', 'Detach ink', () => this.inkAction('detach'), inkActions)
    this.inkAttachment = this.select(inkActions, 'Ink attachment card', [
      ['', 'Selected card or choose attachment'],
    ])
    this.button('Attach selected ink', 'Attach ink', () => this.inkAction('attach'), inkActions)
    this.shape = this.select(
      this.palette,
      'Canvas shape',
      SHAPES.map((s) => [s, s.replace(/-/g, ' ')])
    )
    this.shapeColor = this.select(this.palette, 'Shape color', this.colorOptions())
    this.button('Apply selected shape', 'Change shape', () => this.applyShape(), this.palette)
    this.button(
      'Add canvas shape',
      'Add shape',
      () => this.addText(this.shape.value as Shape),
      this.palette
    )
    for (const [tool, label, text] of [
      ['select', 'Select canvas objects', 'Select'],
      ['frame', 'Draw frame', 'Frame'],
      ['connect', 'Draw connection', 'Connect'],
      ['line', 'Draw free line', 'Line'],
      ['arrow', 'Draw free arrow', 'Arrow'],
    ] as const)
      this.button(
        label,
        text,
        () => {
          this.inputAdapter.cancel()
          this.tool = tool
          this.multiple = false
          this.refresh()
        },
        this.palette
      )
    this.properties = make('details')
    this.properties.className = 'abele-canvas-connection-properties'
    const summary = make('summary')
    summary.textContent = 'Connection style'
    this.properties.append(summary)
    const fields = make('div')
    fields.className = 'abele-canvas-controls'
    this.properties.append(fields)
    this.label = make('input')
    this.label.type = 'text'
    this.label.setAttribute('aria-label', 'Connection label')
    this.label.placeholder = 'Connection label'
    fields.append(this.label)
    this.button('Apply connection style', 'Apply', () => this.applyConnection(), fields)
    this.fromEnd = this.select(fields, 'Start arrow', [
      ['none', 'Start: no arrow'],
      ['arrow', 'Start: arrow'],
    ])
    this.toEnd = this.select(fields, 'End arrow', [
      ['none', 'End: no arrow'],
      ['arrow', 'End: arrow'],
    ])
    this.routing = this.select(fields, 'Connection routing', [
      ['bezier', 'Curved'],
      ['square', 'Elbow'],
      ['direct', 'Straight'],
    ])
    this.color = this.select(fields, 'Connection color', this.colorOptions())
    this.button(
      'Reverse connection arrows',
      'Reverse arrows',
      () => {
        const start = this.fromEnd.value
        this.fromEnd.value = this.toEnd.value
        this.toEnd.value = start
        return this.applyConnection()
      },
      fields
    )
    viewer.el.insertBefore(this.properties, viewer.stage)
    this.button('Add text card', 'Text', () => this.addText())
    this.button('Add note or attachment', 'File', () => this.pick('file'))
    this.button('Add link', 'Link', () => this.pick('link'))
    this.button('Edit card text', 'Edit text', () => this.editText())
    this.button('Open selected card', 'Open', () => {
      const node = this.node()
      if (node) viewer.openNode(node)
    })
    this.button('Delete selected card', 'Delete', () => this.remove())
    this.button('Toggle multiple selection', 'Select multiple', () => {
      this.multiple = !this.multiple
      this.refresh()
    })
    this.button('Group selected cards', 'Group', () => this.group())
    this.button('Ungroup selected group', 'Ungroup', () => this.group(true))
    this.button('Undo canvas change', 'Undo', () => this.history('undo'))
    this.button('Redo canvas change', 'Redo', () => this.history('redo'))
    this.button('Save text', 'Save text', () => this.complete())
    this.button('Keep text draft', 'Keep draft', () => this.keep())
    this.button('Retry save', 'Retry save', () => this.retry())
    this.button('Discard local draft', 'Discard draft…', () => this.discard())
    this.listen(this.text, 'compositionstart', () => {
      this.composing = true
      this.refresh()
    })
    this.listen(this.text, 'compositionend', () => {
      this.composing = false
      this.input()
      this.refresh()
    })
    this.listen(this.text, 'input', () => this.input())
    // Esc, or Mod+Enter, leaves the card with its words saved, as Obsidian Canvas does.
    this.listen(this.text, 'keydown', (e) => {
      const event = e as KeyboardEvent
      if (event.isComposing || this.composing) return
      if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
        event.preventDefault()
        event.stopPropagation()
        void this.complete()
          .catch((error) => this.fail(error))
          .finally(() => viewer.el.focus({ preventScroll: true }))
      }
    })
    this.inputAdapter = new CanvasInput(viewer, {
      tool: () => this.tool,
      brush: (tool) => ({
        color: this.inkColor.value,
        size: WIDTHS[(tool ?? this.tool) === 'marker' ? 'marker' : 'pen'][
          this.inkSize.value as Thickness
        ],
      }),
      pencil: () => ({ ink: this.pencilInk, eraser: 'eraser', fingerDraws: this.fingerDraws }),
      sawPen: () => {
        this.penSeen = true
        this.refresh()
      },
      enabled: () => this.canGesture(),
      holds: () => {
        const document = this.ports.document()
        return (
          this.waiting &&
          !this.destroyed &&
          !this.editing &&
          !!document &&
          !document.state.native &&
          !document.error &&
          !document.session.conflict
        )
      },
      hold: (op) => {
        this.held.push(op)
      },
      selection: () => this.selected,
      select: (ids) => {
        this.selected = ids
        this.refresh()
      },
      multiple: () => this.multiple,
      begin: () => {
        try {
          const document = this.ready()
          this.geometry = {
            document,
            generation: document.session.generation,
            path: document.file.path,
          }
          document.beginDraft()
          this.geometry.generation = document.session.generation
          this.refresh()
          return true
        } catch (error) {
          this.geometry = null
          this.fail(error)
          return false
        }
      },
      valid: () => this.validGeometry(),
      complete: (ops) => {
        void this.completeGeometry(ops).catch((error) => this.fail(error))
      },
      cancel: () => this.cancelGeometry(),
      invalid: (error) => this.fail(error),
      dropped: (drop) => {
        this.drop = drop
        this.refresh()
      },
      double: (target) => this.double(target),
    })
    viewer.onSelect = (node) => {
      if (this.editing || this.waiting) return
      this.selected = new Set(node ? [node.id] : [])
      this.refresh()
    }
    viewer.onEditorKey = (event) => this.key(event)
    // Leaving the window or the app writes at once: a phone may stop it in the background.
    const view = doc.defaultView
    if (view) {
      const leave = (): void => void this.flush()
      view.addEventListener('blur', leave)
      this.off.push(() => view.removeEventListener('blur', leave))
      const hidden = (): void => {
        if (doc.visibilityState === 'hidden') void this.flush()
      }
      doc.addEventListener('visibilitychange', hidden)
      this.off.push(() => doc.removeEventListener('visibilitychange', hidden))
    }
    this.listen(viewer.stage, 'pointermove', (e) => {
      const event = e as PointerEvent,
        r = viewer.stage.getBoundingClientRect(),
        [x, y] = toWorld(viewer.camera, event.clientX - r.left, event.clientY - r.top)
      this.pointer = { x, y }
    })
    this.listen(viewer.el, 'paste', (e) => {
      const event = e as ClipboardEvent,
        target = event.target as Element | null
      if (
        !event.clipboardData ||
        this.editing ||
        this.labeling ||
        this.naming ||
        target?.closest?.('input,textarea,[contenteditable="true"]')
      )
        return
      // What was pasted is read now: the clipboard is gone once the event is over.
      const files = Array.from(event.clipboardData.files),
        text = event.clipboardData.getData('text/plain')
      if (!files.length && !text.trim()) return
      event.preventDefault()
      event.stopPropagation()
      void this.paste(files, text).catch((error) => this.fail(error))
    })
    this.listen(viewer.el, 'keyup', (event) => {
      if ((event as KeyboardEvent).key !== ' ' || this.spaceFrom === null) return
      this.tool = this.spaceFrom
      this.spaceFrom = null
      this.refresh()
    })
    viewer.onFingersTap = (fingers) =>
      this.buttons.get(fingers === 2 ? 'Undo canvas change' : 'Redo canvas change')?.click()
    this.refresh()
  }
  private listen(el: HTMLElement, type: string, fn: EventListener): void {
    el.addEventListener(type, fn)
    this.off.push(() => el.removeEventListener(type, fn))
  }
  private colorOptions(): [string, string][] {
    return [
      ['', 'Default color'],
      ...['1', '2', '3', '4', '5', '6'].map((v, i): [string, string] => [
        v,
        ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Purple'][i],
      ]),
    ]
  }
  private select(
    parent: HTMLElement,
    label: string,
    options: readonly (readonly [string, string])[]
  ): HTMLSelectElement {
    const select = parent.ownerDocument.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'select'
    ) as HTMLSelectElement
    select.setAttribute('aria-label', label)
    select.title = label
    for (const [value, text] of options) {
      const option = parent.ownerDocument.createElementNS(
        'http://www.w3.org/1999/xhtml',
        'option'
      ) as HTMLOptionElement
      option.value = value
      option.textContent = text
      select.append(option)
    }
    parent.append(select)
    return select
  }
  private button(label: string, text: string, action: () => unknown, parent = this.bar): void {
    const button = this.bar.ownerDocument.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'button'
    ) as HTMLButtonElement
    button.type = 'button'
    button.textContent = text
    button.setAttribute('aria-label', label)
    button.title = label
    parent.append(button)
    this.buttons.set(label, button)
    this.listen(button, 'click', () => {
      if (button.disabled) return
      try {
        Promise.resolve(action()).catch((error) => this.fail(error))
      } catch (error) {
        this.fail(error)
      }
    })
  }
  private fail(error: unknown): void {
    this.ports.notice(
      `Canvas change did not complete: ${error instanceof Error ? error.message : 'Local failure'}`
    )
    this.refresh()
  }
  private node() {
    return this.selected.size === 1
      ? this.ports.document()?.session.graph.nodes.find((node) => this.selected.has(node.id))
      : undefined
  }
  /**
   * A new local change may start: unwritten earlier changes and a write in flight do not stop
   * it. A conflict, an uncertain or failed agent write, a rename in progress or native Canvas do.
   */
  private editable(document: CanvasEditorDocument | null): boolean {
    const session = document?.session
    return (
      !!document &&
      !this.destroyed &&
      !this.waiting &&
      !document.state.native &&
      !document.state.conflict &&
      !document.error &&
      !document.recovery &&
      !session.conflict &&
      !session.publicationOutcome &&
      !session.draft?.active &&
      // Someone else's write (an agent's) is landing; local edits would not build on it.
      !session.foreignPublication &&
      (!session.dirty || document.draftPath === document.file.path)
    )
  }
  /** Unwritten human work the scheduler may write now. */
  private writable(document: CanvasEditorDocument): boolean {
    const session = document.session
    // A gesture still in progress is left out of the write and goes with the next one.
    return (
      session.dirty &&
      (session.pendingSteps > 0 || !session.draft?.active) &&
      !session.writing &&
      !session.conflict &&
      !session.publicationOutcome &&
      !document.recovery &&
      !document.error &&
      !document.state.native &&
      !document.state.conflict &&
      document.draftPath === document.file.path
    )
  }
  /** A local change was made: show it now, write it later. */
  private changed(document: CanvasEditorDocument): void {
    if (this.writeFailed === document && !document.session.dirty) this.writeFailed = null
    this.writes.changed(document)
    this.refresh()
  }
  /** Writes all unwritten work now; false when some is still only in memory. */
  async flush(): Promise<boolean> {
    const document = this.ports.document()
    if (!document) return true
    const ok = await this.writes.flush(document)
    if (ok && this.writeFailed === document) this.writeFailed = null
    if (!this.destroyed) this.refresh()
    return ok
  }
  private canGesture(): boolean {
    return !this.editing && (this.editable(this.ports.document()) || this.validGeometry())
  }
  private validGeometry(): boolean {
    const g = this.geometry
    // The gesture's own draft; a write of earlier changes landing meanwhile does not end it.
    return (
      !!g &&
      this.ports.document() === g.document &&
      g.path === g.document.file.path &&
      !!g.document.session.draft?.active &&
      !g.document.session.conflict &&
      !g.document.state.conflict &&
      !g.document.state.native &&
      !g.document.error
    )
  }
  private cancelGeometry(): void {
    const g = this.geometry
    this.geometry = null
    if (g?.document.session.draft?.active) g.document.cancelDraft()
  }
  private async completeGeometry(ops: CanvasOperation[]): Promise<void> {
    const g = this.geometry
    if (!this.validGeometry()) {
      this.cancelGeometry()
      return
    }
    this.geometry = null
    try {
      this.update(g.document, ops)
      for (const op of ops) {
        if (op.op === 'connect') this.selected = new Set([op.edge.id])
        if (op.op === 'add_line') this.selected = new Set([op.line.id])
        const frame =
          op.op === 'add_node' && op.node.kind === 'group'
            ? op.node.id
            : op.op === 'group'
              ? op.id
              : null
        if (frame) {
          // A frame just drawn is named at once, and the hand goes back to picking.
          this.selected = new Set([frame])
          this.naming = frame
          this.tool = 'select'
        }
      }
      g.document.finishDraft()
    } catch (error) {
      if (g.document.session.draft?.active) g.document.cancelDraft()
      throw error
    }
    this.changed(g.document)
  }
  private ready(): CanvasEditorDocument {
    const document = this.ports.document()
    if (!this.editable(document))
      throw new Error('Canvas is busy or has retained pending work; settle it before editing')
    if (this.viewer.step !== null) this.viewer.go(null, false)
    return document
  }
  private update(document: CanvasEditorDocument, ops: CanvasOperation[]): void {
    document.updateDraft((graph) => editCanvas(graph, ops).graph)
  }
  /** One local change, one undo step, written with the next batch. */
  private commit(document: CanvasEditorDocument, ops: CanvasOperation[]): void {
    document.beginDraft()
    try {
      this.update(document, ops)
      document.finishDraft()
    } catch (error) {
      if (document.session.draft?.active) document.cancelDraft()
      throw error
    }
    this.changed(document)
  }
  private location(): { x: number; y: number } {
    const region = this.viewer.visible()
    // Small stagger prevents newly inserted cards hiding every previous card.
    const offset = ((this.ports.document()?.session.graph.nodes.length ?? 0) % 5) * 32
    return {
      x: region.x + region.width / 2 - 130 + offset,
      y: region.y + region.height / 2 - 80 + offset,
    }
  }
  /** A card, or a shape, at the middle of the view, or with its middle at a point. */
  private addText(shape?: Shape, at?: { x: number; y: number }): void {
    const document = this.ready(),
      id = nanoid(),
      size = { width: 260, height: 160 }
    document.beginDraft()
    this.ownedDraft = document
    this.update(document, [
      {
        op: 'add_node',
        node: {
          id,
          kind: shape ? 'shape' : 'text',
          shape,
          ...(shape && this.shapeColor.value ? { color: this.shapeColor.value } : {}),
          label: '',
          ...(at
            ? { x: at.x - size.width / 2, y: at.y - size.height / 2, ...size }
            : this.location()),
        },
      },
    ])
    this.selected = new Set([id])
    this.tool = 'select'
    this.palette.hidden = true
    this.showText(id)
  }
  /** What was pasted, on the canvas where the pointer was, or in the middle of the view. */
  private async paste(files: File[], text: string): Promise<void> {
    const view = this.viewer.visible(),
      p = this.pointer,
      inside =
        p && p.x >= view.x && p.y >= view.y && p.x <= view.x + view.width && p.y <= view.y + view.height
    const at = inside ? p : { x: view.x + view.width / 2, y: view.y + view.height / 2 }
    let pasted: Pasted = { kind: 'text', text }
    if (files.length) {
      const save = this.ports.saveFiles
      if (!save) return
      this.ready()
      let saved: Awaited<ReturnType<typeof save>> = []
      await this.saving(async () => {
        saved = await save(files)
      })
      if (!saved.length) return
      pasted = { kind: 'files', files: saved }
    }
    const document = this.ready(),
      { ops, ids } = pasteOps(pasted, { x: Math.round(at.x), y: Math.round(at.y) })
    document.beginDraft()
    try {
      this.update(document, ops)
    } catch (error) {
      document.discardDraft()
      throw error
    }
    document.finishDraft()
    this.selected = new Set(ids)
    await this.saving(() => this.ports.publish())
  }
  /** Two presses on one place open what is there for writing, or make a card on empty canvas. */
  private double(target: CanvasDouble): void {
    if (target.kind === 'empty') return this.addText(undefined, target.point)
    this.selected = new Set([target.id])
    if (target.kind === 'frame') this.naming = target.id
    else if (target.kind === 'connection') this.labeling = target.id
    else {
      const node = this.node()
      if (node?.type === 'text') return this.editText()
      if (node) this.viewer.openNode(node)
    }
    this.refresh()
  }
  private async saveLabel(id: string, label: string): Promise<void> {
    if (this.labeling === id) this.labeling = null
    const graph = this.ports.document()?.session.graph,
      element =
        graph?.edges.find((e) => e.id === id) ??
        linesOf(graph ?? { nodes: [], edges: [] }).find((l) => l.id === id)
    const text = label.replace(/\s+/g, ' ').trim()
    if (!element || (element.label ?? '') === text) return this.refresh()
    const document = this.ready()
    document.beginDraft()
    this.update(document, [{ op: 'update', id, patch: { label: text || undefined } }])
    document.finishDraft()
    await this.saving(() => this.ports.publish())
  }
  private showText(id: string): void {
    this.editing = id
    this.text.value = this.node()?.text ?? ''
    this.refresh()
    this.text.focus()
  }
  private editText(): void {
    const document = this.ports.document(),
      node = this.node()
    if (
      !document ||
      node?.type !== 'text' ||
      document.state.native ||
      document.error ||
      document.session.conflict ||
      !this.editable(document)
    )
      return
    document.beginDraft()
    this.ownedDraft = document
    this.showText(node.id)
  }
  private input(): void {
    if (!this.editing || !this.ownedDraft || this.ports.document() !== this.ownedDraft) return
    try {
      this.update(this.ownedDraft, [
        { op: 'update', id: this.editing, patch: { text: this.text.value } },
      ])
    } catch (error) {
      this.fail(error)
    }
  }
  private keep(): void {
    if (!this.editing || this.composing || this.waiting) return
    this.input()
    const document = this.ownedDraft
    if (document?.session.draft?.active) document.finishDraft()
    this.editing = null
    this.ownedDraft = null
    this.text.blur()
    if (document) this.changed(document)
    else this.refresh()
  }
  /** Save text: the card's text is one step, written at once rather than with the next batch. */
  private async complete(): Promise<void> {
    if (this.composing || this.waiting || !this.editing) return
    const document = this.ownedDraft
    this.keep()
    // An unchanged text adds no step, so it neither writes nor clears redo.
    if (document && this.ports.document() === document) await this.flush()
  }
  private async saving(action: () => Promise<unknown>): Promise<void> {
    this.waiting = true
    this.refresh()
    try {
      await action()
    } finally {
      this.waiting = false
      this.refresh()
      if (this.held.length) void this.addHeld()
    }
  }
  /** The next stroke drawn while a change was being written, added as a step of its own. */
  private async addHeld(): Promise<void> {
    const op = this.held.shift()
    if (!op || op.op !== 'add_ink') return
    try {
      const document = this.ready()
      document.beginDraft()
      this.update(document, [op])
      document.finishDraft()
    } catch (error) {
      for (const lost of [op, ...this.held.splice(0)])
        if (lost.op === 'add_ink') this.inputAdapter.released(lost.stroke.id)
      return this.fail(error)
    }
    this.inputAdapter.released(op.stroke.id)
    await this.saving(() => this.ports.publish()).catch((error) => this.fail(error))
  }
  private async retry(): Promise<void> {
    const document = this.ports.document()
    if (!document || this.waiting || !this.writable(document)) return
    await this.flush()
  }
  private async pick(kind: 'file' | 'link'): Promise<void> {
    const document = this.ready(),
      generation = document.session.generation,
      path = document.file.path
    await this.saving(async () => {
      const value = await (kind === 'file' ? this.ports.pickFile() : this.ports.pickLink())
      if (!value) return
      if (
        this.destroyed ||
        this.ports.document() !== document ||
        document.session.generation !== generation ||
        document.file.path !== path ||
        document.state.native
      )
        throw new Error('Canvas changed while the picker was open; pick again')
      const node: NodeInput = {
        id: nanoid(),
        kind: kind === 'file' ? 'note' : 'link',
        ...this.location(),
        ...(kind === 'file' ? { file: value } : { url: value }),
      }
      this.commit(document, [{ op: 'add_node', node }])
      this.selected = new Set([node.id])
    })
    this.refresh()
  }
  private async applyShape(): Promise<void> {
    const document = this.ready(),
      node = this.node()
    if (node?.type !== 'text') return
    const ops: CanvasOperation[] = [
      {
        op: 'update',
        id: node.id,
        patch: { color: this.shapeColor.value, styleAttributes: { shape: this.shape.value } },
      },
    ]
    if (
      canvasFingerprint(editCanvas(document.session.graph, ops).graph) ===
      canvasFingerprint(document.session.graph)
    )
      return
    this.commit(document, ops)
  }
  private connection() {
    if (this.selected.size !== 1) return undefined
    const graph = this.ports.document()?.session.graph
    return (
      graph?.edges.find((e) => this.selected.has(e.id)) ??
      linesOf(graph ?? { nodes: [], edges: [] }).find((l) => this.selected.has(l.id))
    )
  }
  private async applyConnection(): Promise<void> {
    const document = this.ready(),
      element = this.connection()
    if (!element) return
    if (JSON.stringify(element) !== this.propertyBaseline)
      throw new Error('Connection changed; select it again before applying its style')
    const patch: Record<string, unknown> = {}
    const changed = (key: string, value: string, previous: unknown) => {
      if (value !== previous) patch[key] = value
    }
    changed('label', this.label.value, element.label ?? '')
    changed('fromEnd', this.fromEnd.value, element.fromEnd ?? 'none')
    changed('toEnd', this.toEnd.value, element.toEnd ?? ('fromNode' in element ? 'arrow' : 'none'))
    if (this.color.value !== '__retain') changed('color', this.color.value, element.color ?? '')
    if ('fromNode' in element)
      changed('pathfindingMethod', this.routing.value, element.pathfindingMethod ?? 'bezier')
    if (!Object.keys(patch).length) {
      this.label.blur()
      return
    }
    if (
      canvasFingerprint(
        editCanvas(document.session.graph, [{ op: 'update', id: element.id, patch }]).graph
      ) === canvasFingerprint(document.session.graph)
    )
      return
    // Release the keyboard before draft notifications disable the field.
    this.label.blur()
    this.commit(document, [{ op: 'update', id: element.id, patch }])
    this.propertyBaseline = JSON.stringify(this.connection())
  }
  private async inkAction(action: 'color' | 'detach' | 'attach'): Promise<void> {
    const document = this.ready(),
      graph = document.session.graph,
      entries = allInkEntries(graph).filter((e) => this.selected.has(e.stroke.id)),
      cards = graph.nodes.filter((n) => this.selected.has(n.id)),
      target = this.inkAttachment.value || (cards.length === 1 ? cards[0].id : '')
    const ops: CanvasOperation[] =
      action === 'color'
        ? [
            ...entries.map((e) => ({
              op: 'update_ink' as const,
              id: e.stroke.id,
              patch: { color: this.inkColor.value },
            })),
            ...graph.nodes
              .filter((n) => this.selected.has(n.id))
              .map((n) => ({
                op: 'update' as const,
                id: n.id,
                patch: { color: this.inkColor.value },
              })),
          ]
        : entries
            .filter((e) => action === 'attach' || e.node)
            .map((e) => ({
              op: 'attach_ink',
              id: e.stroke.id,
              ...(action === 'attach' ? { node: target } : {}),
            }))
    if (!ops.length || (action === 'attach' && !target)) return
    if (canvasFingerprint(editCanvas(graph, ops).graph) === canvasFingerprint(graph)) return
    this.commit(document, ops)
  }
  private async remove(): Promise<void> {
    const document = this.ready()
    if (!this.selected.size) return
    const owned = new Set(
      allInkEntries(document.session.graph)
        .filter((e) => e.node && this.selected.has(e.node.id))
        .map((e) => e.stroke.id)
    )
    this.commit(
      document,
      [...this.selected].filter((id) => !owned.has(id)).map((id) => ({ op: 'remove', id }))
    )
    this.selected.clear()
    this.refresh()
  }
  private async group(ungroup = false): Promise<void> {
    const document = this.ready(),
      node = this.node()
    if (ungroup ? node?.type !== 'group' : this.selected.size < 1) return
    const id = ungroup ? node.id : nanoid()
    document.beginDraft()
    try {
      this.update(document, [
        ungroup
          ? { op: 'ungroup', id }
          : { op: 'group', id, label: 'Frame', ids: [...this.selected] },
      ])
      this.selected = new Set(ungroup ? [] : [id])
      document.finishDraft()
    } catch (error) {
      if (document.session.draft?.active) document.cancelDraft()
      throw error
    }
    if (!ungroup) this.naming = id
    this.changed(document)
  }
  /**
   * The card made at the loose end of a connection stands with its near edge where it was let go,
   * the connection joined to that edge, and a text card or shape opens for its words at once.
   */
  private async dropAdd(kind: 'card' | 'note' | 'shape' | null): Promise<void> {
    const drop = this.drop
    this.drop = null
    if (!drop || !kind || !this.validGeometry()) {
      this.cancelGeometry()
      return this.refresh()
    }
    let file: string | null = null
    if (kind === 'note') {
      file = await this.ports.pickFile()
      if (!file || !this.validGeometry()) {
        this.cancelGeometry()
        return this.refresh()
      }
    }
    const size = kind === 'note' ? { width: 320, height: 240 } : { width: 240, height: 100 },
      toSide = OPPOSITE[drop.side],
      { x, y } = drop.point
    const at = {
      x: Math.round(
        toSide === 'left' ? x : toSide === 'right' ? x - size.width : x - size.width / 2
      ),
      y: Math.round(
        toSide === 'top' ? y : toSide === 'bottom' ? y - size.height : y - size.height / 2
      ),
    }
    const id = nanoid()
    const node: NodeInput =
      kind === 'note'
        ? { id, kind: 'note', file: file, ...at, ...size }
        : {
            id,
            kind: kind === 'shape' ? 'shape' : 'text',
            ...(kind === 'shape' ? { shape: this.shape.value as Shape } : {}),
            label: '',
            ...at,
            ...size,
          }
    await this.completeGeometry([
      { op: 'add_node', node },
      {
        op: 'connect',
        edge: { id: nanoid(), fromNode: drop.source, fromSide: drop.side, toNode: id, toSide },
      },
    ])
    this.selected = new Set([id])
    // The new card stands clear of the tools at the foot, so its words can be written in view.
    this.viewer.reveal({ ...at, ...size }, { bottom: 96 })
    if (kind !== 'note') this.editText()
    else this.refresh()
  }
  private async act(action: CanvasAction): Promise<void> {
    const graph = this.ports.document()?.session.graph
    if (!graph || !this.selected.size) return
    const picked = graph.nodes.filter((n) => this.selected.has(n.id))
    if (action === 'copy') {
      const ids = new Set(moveIds(graph, new Set(picked.map((n) => n.id))))
      const nodes = graph.nodes.filter((n) => ids.has(n.id)),
        edges = graph.edges.filter(
          (e) => this.selected.has(e.id) || (ids.has(e.fromNode) && ids.has(e.toNode))
        )
      await this.viewer.el.ownerDocument.defaultView?.navigator.clipboard?.writeText(
        JSON.stringify({ nodes, edges }, null, '\t')
      )
      this.ports.notice(`Copied ${nodes.length + edges.length} to the clipboard`)
      return
    }
    const document = this.ready()
    let ops: CanvasOperation[]
    let after: Set<string> | null = null
    if (action === 'front' || action === 'back') {
      ops = [{ op: 'order', ids: [...this.selected], place: action }]
    } else if (action === 'delete-with-contents') {
      const all = moveIds(graph, new Set(picked.map((n) => n.id)))
      // Inner cards first, so no frame's removal promotes a child that is about to go too.
      const parents = parentsOf(graph),
        depth = (id: string) => {
          let d = 0
          for (let p = parents.get(id); p; p = parents.get(p)) d++
          return d
        }
      ops = [...all].sort((a, b) => depth(b) - depth(a)).map((id) => ({ op: 'remove', id }))
      after = new Set()
    } else {
      // A copy of the picked cards, frames with what is inside them, and the connections among
      // them, standing beside them to the right, so a copied frame never lands on its original.
      const ids = moveIds(graph, new Set(picked.map((n) => n.id))),
        fresh = new Map([...ids].map((id) => [id, nanoid()])),
        shift = bounds(graph.nodes.filter((n) => ids.has(n.id))).width + COPY_GAP
      const parents = parentsOf(graph)
      const nodes = graph.nodes
        .filter((n) => ids.has(n.id))
        // Frames before what they hold, an outer frame before an inner one.
        .sort(
          (a, b) =>
            Number(b.type === 'group') - Number(a.type === 'group') ||
            (a.type === 'group' && b.type === 'group' ? b.width * b.height - a.width * a.height : 0)
        )
      ops = [
        ...nodes.map(
          (n): CanvasOperation => ({
            op: 'add_node',
            node: {
              id: fresh.get(n.id),
              kind:
                n.type === 'file'
                  ? 'note'
                  : n.type === 'text' && n.styleAttributes?.shape
                    ? 'shape'
                    : n.type,
              ...(n.type === 'text' ? { label: n.text ?? '' } : {}),
              ...(n.type === 'group' ? { label: n.label ?? '' } : {}),
              ...(n.file ? { file: n.file } : {}),
              ...(n.subpath ? { subpath: n.subpath } : {}),
              ...(n.url ? { url: n.url } : {}),
              ...(n.styleAttributes?.shape ? { shape: n.styleAttributes.shape as Shape } : {}),
              ...(n.color ? { color: n.color } : {}),
              ...(fresh.has(parents.get(n.id) ?? '')
                ? { parent: fresh.get(parents.get(n.id)) }
                : {}),
              x: n.x + shift,
              y: n.y,
              width: n.width,
              height: n.height,
            },
          })
        ),
        ...graph.edges
          .filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
          .map(
            (e): CanvasOperation => ({
              op: 'connect',
              edge: {
                ...e,
                id: nanoid(),
                fromNode: fresh.get(e.fromNode),
                toNode: fresh.get(e.toNode),
              },
            })
          ),
      ]
      after = new Set(picked.map((n) => fresh.get(n.id)))
    }
    if (!ops.length) return
    document.beginDraft()
    this.update(document, ops)
    document.finishDraft()
    if (after) this.selected = after
    await this.saving(() => this.ports.publish())
  }
  private async replaceWithNote(id: string, path: string): Promise<void> {
    const document = this.ready(),
      node = document.session.graph.nodes.find((n) => n.id === id)
    if (node?.type !== 'text') return
    document.beginDraft()
    this.update(document, [
      { op: 'update', id, patch: { type: 'file', file: path, text: undefined } },
    ])
    document.finishDraft()
    this.selected = new Set([id])
    await this.saving(() => this.ports.publish())
  }
  /** Renames, folds or unfolds one frame as a single step to undo. */
  private async frameOp(
    id: string,
    action: 'rename' | 'collapse' | 'expand',
    label?: string
  ): Promise<void> {
    if (action === 'rename') this.naming = null
    const document = this.ready(),
      frame = document.session.graph.nodes.find((n) => n.id === id && n.type === 'group')
    if (!frame) return this.refresh()
    const ops: CanvasOperation[] =
      action === 'rename'
        ? [{ op: 'update', id, patch: { label: label?.trim() || 'Frame' } }]
        : [{ op: 'collapse', id, collapsed: action === 'collapse' }]
    if (
      canvasFingerprint(editCanvas(document.session.graph, ops).graph) ===
      canvasFingerprint(document.session.graph)
    )
      return this.refresh()
    this.commit(document, ops)
  }
  /** Undo and redo happen in memory at once; the result is written with the next batch. */
  private history(direction: 'undo' | 'redo'): void {
    const document = this.ready()
    if (direction === 'undo') document.undoLocal()
    else document.redoLocal()
    this.changed(document)
  }
  private async discard(): Promise<void> {
    const document = this.ports.document()
    if (
      !document ||
      this.waiting ||
      this.composing ||
      document.session.publicationOutcome ||
      document.recovery ||
      (document.session.busy && this.ownedDraft !== document)
    )
      return
    const generation = document.session.generation
    await this.saving(async () => {
      if (!(await this.ports.confirmDiscard())) return
      if (
        this.destroyed ||
        this.ports.document() !== document ||
        document.session.generation !== generation
      )
        throw new Error('Canvas changed while confirmation was open; draft was kept')
      document.discardDraft()
      if (this.writeFailed === document) this.writeFailed = null
      this.editing = null
      this.ownedDraft = null
      this.text.blur()
    })
  }
  /** The only human native exit: an explicit local retain/discard, never an implicit save. */
  async prepareNative(): Promise<boolean> {
    const document = this.ports.document()
    if (!document) return !this.waiting
    if (this.waiting || this.composing) return false
    this.inputAdapter.cancel()
    if (this.editing) this.keep()
    // Native Canvas reads the file: write what is only in memory first.
    await this.writes.flush(document)
    if (this.destroyed || this.ports.document() !== document) return false
    if (document.session.busy) {
      this.ports.notice('Another canvas edit is active; finish it before opening native Canvas')
      return false
    }
    if (document.session.dirty) {
      const generation = document.session.generation,
        path = document.file.path
      let choice: 'stay' | 'retain' | 'discard' = 'stay'
      await this.saving(async () => {
        choice = await this.ports.handoffChoice()
      })
      if (
        this.destroyed ||
        this.ports.document() !== document ||
        document.session.generation !== generation ||
        document.file.path !== path ||
        choice === 'stay'
      )
        return false
      if (choice === 'discard') {
        if (document.session.publicationOutcome || document.recovery) {
          this.ports.notice(
            'Use Recover failed canvas change to review and discard this retained change first'
          )
          return false
        }
        document.discardDraft()
      }
    }
    document.releaseWriter(true)
    return true
  }
  private field(field: CanvasField): HTMLSelectElement | HTMLInputElement {
    return {
      'ink-color': this.inkColor,
      'ink-size': this.inkSize,
      shape: this.shape,
      'shape-color': this.shapeColor,
      label: this.label,
      'from-end': this.fromEnd,
      'to-end': this.toEnd,
      routing: this.routing,
      'connection-color': this.color,
    }[field]
  }
  private picked(): CanvasPicked {
    const graph = this.ports.document()?.session.graph ?? { nodes: [], edges: [] }
    const kinds: CanvasPicked['kinds'] = [],
      rects: Rect[] = []
    for (const id of this.selected) {
      const node = graph.nodes.find((n) => n.id === id)
      if (node) {
        kinds.push(node.type === 'text' && node.styleAttributes?.shape ? 'shape' : node.type)
        rects.push(node)
        continue
      }
      const edge = graph.edges.find((e) => e.id === id)
      if (edge) {
        kinds.push('connection')
        // Where the line runs, not the cards it joins, so the bar over it stands by it.
        const points = routeSamples(paintedRoute(edge, graph)),
          xs = points.map((p) => p.x),
          ys = points.map((p) => p.y)
        if (points.length) {
          const x = Math.min(...xs),
            y = Math.min(...ys)
          rects.push({ x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y })
        }
        continue
      }
      const line = linesOf(graph).find((l) => l.id === id)
      if (line) {
        kinds.push('line')
        rects.push(lineBounds(line))
        continue
      }
      const ink = allInkEntries(graph).find((e) => e.stroke.id === id)
      if (ink) {
        kinds.push('stroke')
        rects.push(inkBounds(ink))
      }
    }
    return { ids: [...this.selected], kinds, rect: rects.length ? bounds(rects) : null }
  }
  refresh(): void {
    if (this.destroyed) return
    this.inputAdapter?.validate()
    const document = this.ports.document(),
      session = document?.session,
      node = this.node()
    const graph = session?.graph,
      ids = new Set(
        [
          ...(graph?.nodes ?? []),
          ...(graph?.edges ?? []),
          ...linesOf(graph ?? { nodes: [], edges: [] }),
          ...inkEntries(graph ?? { nodes: [], edges: [] }).map((e) => e.stroke),
          // A connection being pulled, or loose and waiting for its menu, stays picked in the accent.
          ...(this.drop || this.geometry ? linesOf(this.viewer.graph) : []),
        ].map((e) => e.id)
      )
    this.selected = new Set([...this.selected].filter((id) => ids.has(id)))
    this.viewer.selection = this.selected
    this.viewer.draw()
    if (document && this.flushHook?.document !== document) {
      // The store writes this document's unwritten work before anyone else reads or writes it.
      if (this.flushHook && this.flushHook.document.writes === this.flushHook)
        this.flushHook.document.writes = null
      this.flushHook = { document, flush: () => this.writes.flush(document) }
      document.writes = this.flushHook
      // Work left unwritten by an earlier tab is written like a new change.
      if (this.writable(document)) this.writes.changed(document)
    }
    const active = !!this.editing,
      blocked = !this.editable(document),
      // Unwritten work is normal; it is only shown as retained when it cannot simply be written.
      retained =
        !!session?.dirty &&
        (this.writeFailed === document ||
          !!session.conflict ||
          !!document.recovery ||
          !!session.publicationOutcome ||
          document.draftPath !== document.file.path)
    for (const label of [
      'Shapes and connections',
      'Add text card',
      'Add note or attachment',
      'Add link',
      'Edit card text',
      'Open selected card',
      'Delete selected card',
      'Toggle multiple selection',
      'Group selected cards',
      'Ungroup selected group',
    ])
      this.buttons.get(label).hidden = !this.inkControls.hidden
    const ink = allInkEntries(graph ?? { nodes: [], edges: [] }).filter((e) =>
        this.selected.has(e.stroke.id)
      ),
      groupable =
        this.selected.size > 0 &&
        [...this.selected].every(
          (id) => graph?.nodes.some((n) => n.id === id) || ink.some((e) => e.stroke.id === id)
        )
    this.inkSelectionControls.hidden = this.tool !== 'lasso'
    const attachment = this.inkAttachment.value
    this.inkAttachment.replaceChildren()
    for (const [value, text] of [
      ['', 'Selected card or choose attachment'],
      ...canvasVisibility(graph ?? { nodes: [], edges: [] }).visible.map((n) => [
        n.id,
        n.type === 'group'
          ? n.label || 'Group'
          : n.type === 'text'
            ? n.text?.slice(0, 40) || 'Text card'
            : n.file || n.url || 'Card',
      ]),
    ]) {
      const option = this.inkAttachment.ownerDocument.createElementNS(
        'http://www.w3.org/1999/xhtml',
        'option'
      ) as HTMLOptionElement
      option.value = value
      option.textContent = text
      this.inkAttachment.append(option)
    }
    this.inkAttachment.value = attachment
    this.inkAttachment.disabled = blocked || !ink.length
    this.buttons.get('Toggle lasso multiple selection').disabled = blocked
    this.buttons
      .get('Toggle lasso multiple selection')
      .setAttribute('aria-pressed', String(this.multiple))
    this.buttons.get('Delete canvas selection').disabled = blocked || !this.selected.size
    this.buttons.get('Group canvas selection').disabled = blocked || !groupable
    this.buttons.get('Ungroup canvas selection').disabled = blocked || node?.type !== 'group'
    this.buttons.get('Recolor canvas selection').disabled = blocked || !groupable
    this.buttons.get('Detach selected ink').disabled = blocked || !ink.some((e) => e.node)
    this.buttons.get('Attach selected ink').disabled = blocked || !ink.length
    const connection = this.connection()
    this.properties.hidden = !connection || active || !this.inkControls.hidden
    if (
      connection &&
      (connection.id !== this.propertyId ||
        !this.properties.contains(this.properties.ownerDocument.activeElement))
    ) {
      this.propertyId = connection.id
      this.propertyBaseline = JSON.stringify(connection)
      this.label.value = connection.label ?? ''
      this.fromEnd.value = connection.fromEnd ?? 'none'
      this.toEnd.value = connection.toEnd ?? ('fromNode' in connection ? 'arrow' : 'none')
      // Unsupported Advanced Canvas routing and custom colours are retained unless explicitly changed.
      const retainOption = (select: HTMLSelectElement, value: string) => {
        if (!Array.from(select.options).some((o) => o.value === value)) {
          const option = select.ownerDocument.createElementNS(
            'http://www.w3.org/1999/xhtml',
            'option'
          ) as HTMLOptionElement
          option.value = value
          option.textContent = 'Retain existing'
          select.append(option)
        }
        select.value = value
      }
      retainOption(
        this.routing,
        'fromNode' in connection
          ? typeof connection.pathfindingMethod === 'string'
            ? connection.pathfindingMethod
            : 'bezier'
          : 'direct'
      )
      retainOption(
        this.color,
        connection.color && !/^[1-6]$/.test(connection.color)
          ? '__retain'
          : (connection.color ?? '')
      )
    }
    this.routing.disabled = blocked || !connection || !('fromNode' in connection)
    this.buttons.get('Apply selected shape').disabled = blocked || node?.type !== 'text'
    for (const field of [
      this.inkColor,
      this.inkSize,
      this.shape,
      this.shapeColor,
      this.label,
      this.fromEnd,
      this.toEnd,
      this.color,
    ])
      field.disabled = blocked
    for (const label of ['Apply connection style', 'Reverse connection arrows'])
      this.buttons.get(label).disabled = blocked || !connection
    for (const [tool, label] of [
      ['pan', 'Navigate canvas'],
      ['pen', 'Draw with pen'],
      ['marker', 'Draw with marker'],
      ['eraser', 'Erase whole strokes'],
      ['partial-eraser', 'Erase part of strokes'],
      ['lasso', 'Lasso canvas objects'],
      ['select', 'Select canvas objects'],
      ['frame', 'Draw frame'],
      ['connect', 'Draw connection'],
      ['line', 'Draw free line'],
      ['arrow', 'Draw free arrow'],
    ] as const) {
      this.buttons.get(label).disabled = blocked
      this.buttons.get(label).setAttribute('aria-pressed', String(this.tool === tool))
    }
    for (const label of ['Add text card', 'Add note or attachment', 'Add link', 'Add canvas shape'])
      this.buttons.get(label).disabled = blocked
    this.buttons.get('Edit card text').disabled =
      !document ||
      this.waiting ||
      active ||
      node?.type !== 'text' ||
      !!document.error ||
      document.state.native ||
      !this.editable(document)
    this.buttons.get('Open selected card').disabled =
      active || !node || !['file', 'link'].includes(node.type)
    this.buttons.get('Delete selected card').disabled = blocked || !this.selected.size
    this.buttons.get('Toggle multiple selection').disabled = blocked
    this.buttons
      .get('Toggle multiple selection')
      .setAttribute('aria-pressed', String(this.multiple))
    this.buttons.get('Group selected cards').disabled =
      blocked ||
      this.selected.size < 2 ||
      [...this.selected].some((id) => !graph?.nodes.some((n) => n.id === id))
    this.buttons.get('Ungroup selected group').disabled = blocked || node?.type !== 'group'
    for (const direction of ['undo', 'redo'] as const)
      this.buttons.get(
        direction === 'undo' ? 'Undo canvas change' : 'Redo canvas change'
      ).disabled = blocked || !session?.localHistory[direction]
    for (const label of ['Save text', 'Keep text draft']) {
      const button = this.buttons.get(label)
      button.hidden = !active
      button.disabled = this.composing || this.waiting
    }
    this.panel.hidden = !active
    const retry = this.buttons.get('Retry save'),
      discard = this.buttons.get('Discard local draft')
    // A live gesture is a preview, not retained work to retry/discard. On a narrow screen
    // these extra buttons wrap and move the stage underneath the captured pointer.
    retry.hidden =
      !!this.geometry ||
      !retained ||
      active ||
      !!document?.recovery ||
      !!session?.publicationOutcome
    retry.disabled = this.waiting || !document || !this.writable(document)
    discard.hidden =
      !!this.geometry || !retained || !!document?.recovery || !!session?.publicationOutcome
    discard.disabled =
      this.waiting || this.composing || (!!session?.busy && this.ownedDraft !== document)
    const penHint =
      'Draw on a card to attach ink; start on the background for free ink. Two fingers navigate.'
    const eraserHint = 'Drag over ink to erase. Two fingers navigate; Undo restores the gesture.'
    this.status.textContent = this.geometry
      ? this.tool === 'pen' || this.tool === 'marker'
        ? penHint
        : this.tool === 'eraser' || this.tool === 'partial-eraser'
          ? eraserHint
          : 'Canvas gesture in progress…'
      : retained
        ? 'Unsaved canvas work — retained in memory only; not saved. Reloading or crashing can lose it.' +
          (session.conflict || (document.draftPath && document.draftPath !== document.file.path)
            ? ' The source changed; retry is blocked. Keep or explicitly discard this local draft.'
            : '') +
          (!document.draftPath && !document.recovery && !session.publicationOutcome
            ? ' Discard this local history preview before trying Undo or Redo again.'
            : '')
        : this.waiting
          ? 'Canvas operation in progress…'
          : this.selected.size
            ? this.selected.size === 1
              ? `Selected ${node?.type ?? (ink.length ? 'stroke' : 'connection')}`
              : `${this.selected.size} objects selected`
            : this.tool === 'lasso'
              ? 'Circle cards and ink to select; drag the selection to move or its corner to scale. Open Selection actions to edit it.'
              : this.tool === 'eraser' || this.tool === 'partial-eraser'
                ? eraserHint
                : this.tool === 'pen' || this.tool === 'marker'
                  ? penHint
                  : this.tool === 'connect'
                    ? 'Drag from a card to another card to connect them.'
                    : this.tool === 'line' || this.tool === 'arrow'
                      ? 'Drag to draw a free line or arrow.'
                      : ''
    for (const fn of this.watchers) fn()
  }
  private key(event: KeyboardEvent): boolean {
    if (
      this.editing ||
      this.waiting ||
      event.isComposing ||
      (event.target instanceof Element && event.target.closest('button'))
    )
      return false
    if (event.key === 'Escape' && this.viewer.step === null) {
      this.inputAdapter.cancel()
      this.selected.clear()
      this.tool = 'select'
      this.refresh()
      event.preventDefault()
      return true
    }
    const command = event.metaKey || event.ctrlKey
    if (event.key === ' ' && this.viewer.step === null && !command) {
      // Space held moves the canvas whatever is in hand, as in every drawing tool.
      if (!event.repeat && this.spaceFrom === null && this.tool !== 'pan') {
        this.inputAdapter.cancel()
        this.spaceFrom = this.tool
        this.tool = 'pan'
        this.refresh()
      }
      event.preventDefault()
      return true
    }
    const tools: Record<string, [string, string?]> = {
      v: ['Select canvas objects'],
      h: ['Navigate canvas'],
      a: ['Draw connection'],
      f: ['Draw frame'],
      l: ['Lasso canvas objects'],
      p: ['Draw with pen', 'Draw with marker'],
      e: ['Erase whole strokes', 'Erase part of strokes'],
      t: ['Add text card'],
      n: ['Add note or attachment'],
      w: ['Add link'],
      r: ['Add canvas shape'],
    }
    const letter = event.key.length === 1 ? event.key.toLowerCase() : ''
    if (!command && !event.altKey && tools[letter]) {
      const [first, again] = tools[letter],
        pressed = this.buttons.get(first)?.getAttribute('aria-pressed') === 'true'
      event.preventDefault()
      event.stopPropagation()
      this.buttons.get(pressed && again ? again : first)?.click()
      return true
    }
    let label: string
    if (command && event.key.toLowerCase() === 'z')
      label = event.shiftKey ? 'Redo canvas change' : 'Undo canvas change'
    else if (command && event.key.toLowerCase() === 'y') label = 'Redo canvas change'
    else if (event.key === 'Delete' || event.key === 'Backspace') label = 'Delete selected card'
    else if (event.key === 'Enter' && this.node()?.type === 'group') {
      this.naming = this.node().id
      this.refresh()
      event.preventDefault()
      return true
    } else if (event.key === 'Enter') label = 'Edit card text'
    else return false
    event.preventDefault()
    event.stopPropagation()
    this.buttons.get(label)?.click()
    return true
  }
  destroy(): void {
    void this.close()
  }
  /** Closing writes what is only in memory. Resolves false when some of it could not be written. */
  close(): Promise<boolean> {
    if (this.destroyed) return Promise.resolve(true)
    const document = this.ports.document()
    this.inputAdapter.destroy()
    if (this.ownedDraft === document && this.ownedDraft?.session.draft?.active) {
      this.input()
      this.ownedDraft.finishDraft()
    }
    const written = document ? this.writes.flush(document) : Promise.resolve(true)
    this.writes.dispose()
    this.destroyed = true
    this.off.splice(0).forEach((fn) => fn())
    this.viewer.onSelect = undefined
    this.viewer.onEditorKey = undefined
    this.viewer.onFingersTap = undefined
    this.viewer.selection = new Set()
    this.bar.remove()
    this.panel.remove()
    this.status.remove()
    this.palette.remove()
    this.inkControls.remove()
    this.properties.remove()
    return written
  }
}
