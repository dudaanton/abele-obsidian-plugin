/**
 * Human interaction over the existing shared document. Every change applies in memory at once,
 * one undo step each; writing the file is batched by the write scheduler, later and less often.
 */
import { nanoid } from 'nanoid'
import { editCanvas, type CanvasOperation, type NodeInput } from './core/edit'
import {
  bounds,
  canvasFingerprint,
  parentsOf,
  SHAPES,
  type CanvasGraph,
  type Rect,
  type Shape,
} from './core/model'
import { moveIds } from './core/selection'
import { clipOf, copyOps, parseClip } from './core/copy'
import { lineBounds, linesOf } from './core/primitives'
import { labelPoint, paintedRoute, routeSamples } from './core/scene'
import { hitNode } from './core/selection'
import { canvasKey, frameAround, pastedUrl, PICTURE_TYPES, pictureSize } from './editorKeys'
import { CARD_SIZE, connectionAt } from './input'
import { allInkEntries, inkBounds, inkEntries } from './core/ink'
import { canvasVisibility } from './core/visibility'
import type { CanvasSession, GraphTransform } from './core/session'
import { CanvasSessionError } from './core/session'
import {
  CANVAS_TEXT_SCHEDULE,
  CanvasWriteScheduler,
  type CanvasWriteSchedule,
} from './core/writeScheduler'
import type { CanvasViewer } from './Viewer'
import { CanvasInput, OPPOSITE, type CanvasDrop, type CanvasInputTool } from './input'
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
  /** Redraws every view of the document, its status line included. */
  notify?(): void
}
export interface CanvasEditorPorts {
  document(): CanvasEditorDocument | null
  /** Writes the document's unwritten human work to its file. */
  publish(document: CanvasEditorDocument): Promise<unknown>
  /** When unwritten work is written; tests shorten it. */
  schedule?: CanvasWriteSchedule
  /** When typed card text becomes a step and is written; tests lengthen or shorten it. */
  textSchedule?: CanvasWriteSchedule
  pickFile(): Promise<string | null>
  pickLink(): Promise<string | null>
  confirmDiscard(): Promise<boolean>
  handoffChoice(): Promise<'stay' | 'retain' | 'discard'>
  notice(message: string): void
  /**
   * Saves a pasted or dropped file next to the canvas's attachments and gives back its path in
   * the vault, or null when nothing could be saved.
   */
  saveAttachment?(name: string, data: ArrayBuffer): Promise<string | null>
  /** The headings of a note, for showing one part of it on a card. */
  noteHeadings?(path: string): Promise<{ heading: string; level: number }[]>
  /** Makes a new note beside the canvas holding these words, and gives back its path. */
  createNote?(name: string, text: string): Promise<string | null>
  /** What a drop from the host's own file list carries, as paths in the vault. */
  droppedPaths?(event: DragEvent): string[]
}
/** What is picked, for a bar of actions standing over it. */
export interface CanvasPicked {
  ids: string[]
  kinds: ('text' | 'shape' | 'file' | 'link' | 'group' | 'connection' | 'line' | 'stroke')[]
  /** Around all of it, in the canvas's own units. */
  rect: Rect | null
  /**
   * Where the bar of actions stands over it: around all of it, or for one connection or line,
   * at its label in the middle of the line, so the bar opens at the line that was pressed.
   */
  anchor: Rect | null
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
export type CanvasAction =
  | 'duplicate'
  | 'copy'
  | 'front'
  | 'back'
  | 'delete-with-contents'
  | 'turn-into-note'
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
  /** A pen has touched this canvas, so it is a device with a Pencil. */
  private penSeen = false
  /** On a device with a Pencil, whether a finger draws too; kept on this device. */
  private fingerDraws = readFingerDraws()
  /** A frame whose name is being written on its label. */
  private naming: string | null = null
  /** A connection or line whose label is being written on the line itself. */
  private labelling: string | null = null
  /** The find bar is open over the canvas. */
  private finding = false
  /** Space held down: the hand, whatever tool is in hand, until it is let go. */
  private spaceHeld = false
  /** Where the pointer last was over the canvas, in its own units: where a paste lands. */
  private pointerAt: [number, number] | null = null
  private ownedDraft: CanvasEditorDocument | null = null
  /** Strokes drawn while the last change was being written, added one by one after it. */
  private held: CanvasOperation[] = []
  private composing = false
  private textTimer: number | null = null
  private textFirst: number | null = null
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
    tool: (): CanvasInputTool => (this.spaceHeld ? 'pan' : this.tool),
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
      // Chrome menus edit the hidden fields without focusing the properties panel.
      // Keep those pending values until Apply reads them.
      this.refresh(false)
    },
    picked: (): CanvasPicked => this.picked(),
    editing: (): string | null => this.editing,
    textField: (): HTMLTextAreaElement => this.text,
    /** The frame whose name is being written, so its label opens for writing. */
    naming: (): string | null => this.naming,
    name: (id: string | null): void => {
      this.naming = id
      if (!id) this.regainKeys()
      this.refresh()
    },
    renameFrame: (id: string, label: string): Promise<void> => this.frameOp(id, 'rename', label),
    /** The connection or line whose label is open for writing on the line. */
    labelling: (): string | null => this.labelling,
    editLabel: (id: string | null): void => {
      this.labelling = id
      if (!id) this.regainKeys()
      if (id) this.selected = new Set([id])
      this.refresh()
    },
    saveLabel: (id: string, label: string): Promise<void> => this.saveLabel(id, label),
    /** Whether the find bar is open, and opening or closing it. */
    finding: (): boolean => this.finding,
    setFinding: (on: boolean): void => {
      this.finding = on
      if (!on) this.viewer.el.focus({ preventScroll: true })
      this.refresh()
    },
    /** Picks one thing found and brings it into view. */
    show: (id: string): void => this.show(id),
    /** Takes a tool in hand, as its key or its button does. */
    useTool: (tool: CanvasInputTool): void => this.useTool(tool),
    /** The headings of the picked note, for showing one part of it. */
    headings: (path: string): Promise<{ heading: string; level: number }[]> =>
      this.ports.noteHeadings?.(path) ?? Promise.resolve([]),
    /** Shows one part of a note on its card, from a heading on; empty shows the whole note. */
    showPart: (id: string, subpath: string): Promise<void> => this.showPart(id, subpath),
    /** Adds one part of a note as a card of its own beside the note's card. */
    addPart: (id: string, subpath: string): Promise<void> => this.addPart(id, subpath),
    /** The heading the picked note's card has scrolled to, if it has scrolled past one. */
    foldFrame: (id: string, collapsed: boolean): Promise<void> =>
      this.frameOp(id, collapsed ? 'collapse' : 'expand'),
    /**
     * What the picked things' "more" menu does: a copy beside them, the canvas's own JSON on the
     * clipboard, stacking, and taking a frame away together with what is inside it.
     */
    act: (action: CanvasAction): Promise<void> => this.act(action),
    /** A note on the canvas shows one part of itself, a heading or a block, or all of it. */
    setSubpath: (id: string, subpath: string): Promise<void> =>
      this.patchNode(id, { subpath: subpath || undefined }),
    /** A card pinned in place is picked but not carried or resized by hand. */
    setPinned: (id: string, pinned: boolean): Promise<void> =>
      this.patchNode(id, { abele: { pinned: pinned || undefined } }),
    /** A note shows Abele's header and footer inside its card, or not, whatever the canvas's default. */
    setPanels: (id: string, shown: boolean): Promise<void> =>
      this.patchNode(id, { abele: { panels: shown } }),
    /** Whether the canvas's notes show Abele's header and footer when a card has no choice of its own. */
    notePanels: (): boolean => this.ports.document()?.session.graph.abele?.notePanels === true,
    setNotePanels: (on: boolean): void => {
      const document = this.ready()
      document.beginDraft()
      try {
        document.updateDraft((graph) => ({
          ...graph,
          abele: { ...graph.abele, notePanels: on },
        }))
        document.finishDraft()
      } catch (error) {
        if (document.session.draft?.active) document.cancelDraft()
        throw error
      }
      this.changed(document)
    },
    /** A connection let go over nothing, waiting to be told what to make there. */
    drop: (): CanvasDrop | null => this.drop,
    /** Makes a card, a note or a shape at the end of the dropped connection, or nothing. */
    dropAdd: (kind: 'card' | 'note' | 'shape' | null): Promise<void> => this.dropAdd(kind),
    /** A pen has touched the canvas, so a finger moves it rather than drawing unless told to. */
    pencil: (): boolean => this.penSeen,
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
          // One failure is told once; later attempts that fail the same way stay quiet.
          const repeated = this.writeFailed === document
          this.writeFailed = document
          if (!repeated) this.fail(error)
          // The views were redrawn before the failure reached here; their status says it now.
          if (document.notify) document.notify()
          else this.refresh()
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
      ['card', 'Place text card', 'Card'],
      ['shape', 'Place canvas shape', 'Place shape'],
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
    this.button('Add a picture', 'Picture', () => this.pickPictures())
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
    // The field stands on its card, so a press anywhere else leaves it: the card's words are
    // written and editing ends. A field left mid-composition, as a phone's keyboard can be
    // dismissed, has finished it: the words written so far are kept. After a failed write the
    // card stays open with its words and waits for the person's Retry or Discard.
    this.listen(this.text, 'blur', () => {
      if (this.composing) {
        this.composing = false
        this.input()
        this.refresh()
      }
      if (!this.writeFailing) void this.finishText()
    })
    // Esc, or Cmd+Enter, finishes writing on a card, as a tap beside it does.
    this.listen(this.text, 'keydown', (event) => {
      const e = event as KeyboardEvent
      if (e.isComposing || this.composing) return
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        e.stopPropagation()
        void this.finishText()
          .catch((error) => this.fail(error))
          .finally(() => this.viewer.el.focus({ preventScroll: true }))
      }
    })
    this.inputAdapter = new CanvasInput(viewer, {
      tool: () => (this.spaceHeld ? 'pan' : this.tool),
      brush: (tool) => ({
        color: this.inkColor.value,
        size: WIDTHS[(tool ?? this.tool) === 'marker' ? 'marker' : 'pen'][
          this.inkSize.value as Thickness
        ],
      }),
      pencil: () => ({ eraser: 'eraser', fingerDraws: this.fingerDraws }),
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
        // The last change may have been written while this stroke was still being drawn.
        if (!this.waiting) void this.addHeld()
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
      placed: (kind, rect) => {
        try {
          this.addText(kind === 'shape' ? (this.shape.value as Shape) : undefined, rect)
          // Put down by an edge, it is brought whole into view so its words can be written.
          this.viewer.reveal(rect)
        } catch (error) {
          this.fail(error)
        }
      },
      copied: (ids, dx, dy) => {
        void this.copyBy(ids, dx, dy).catch((error) => this.fail(error))
      },
    })
    viewer.onDoubleTap = (event) => this.doubleTap(event)
    // A canvas opened in its tab takes the keys at once, so its letters work before any click,
    // unless something else already has them.
    queueMicrotask(() => {
      const doc = viewer.el.ownerDocument
      if (
        !this.destroyed &&
        viewer.el.isConnected &&
        (!doc.activeElement || doc.activeElement === doc.body)
      )
        viewer.el.focus({ preventScroll: true })
    })
    viewer.onWheel = (event) => this.wheel(event)
    this.listen(viewer.el, 'keyup', (event) => {
      if ((event as KeyboardEvent).key === ' ' && this.spaceHeld) {
        this.spaceHeld = false
        viewer.stage.classList.remove('is-panning')
        this.refresh()
      }
    })
    this.listen(viewer.el, 'blur', () => {
      if (this.spaceHeld) {
        this.spaceHeld = false
        viewer.stage.classList.remove('is-panning')
        this.refresh()
      }
    })
    this.listen(viewer.stage, 'pointermove', (event) => {
      const e = event as PointerEvent,
        r = viewer.stage.getBoundingClientRect(),
        cam = viewer.camera
      this.pointerAt = [
        (e.clientX - r.left) / cam.zoom + cam.x,
        (e.clientY - r.top) / cam.zoom + cam.y,
      ]
    })
    this.listen(viewer.el, 'paste', (event) => void this.paste(event as ClipboardEvent))
    this.listen(viewer.stage, 'dragover', (event) => {
      const e = event as DragEvent
      if (!this.canGesture()) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    })
    this.listen(viewer.stage, 'drop', (event) => void this.dropIn(event as DragEvent))
    viewer.onSelect = (node) => {
      if (this.waiting) return
      // Tapping the canvas ends text editing, as leaving a note does; the text is written.
      if (this.editing) {
        if (this.composing) return
        void this.finishText()
      }
      this.selected = new Set(node ? [node.id] : [])
      this.refresh()
    }
    viewer.onEditorKey = (event) => this.key(event)
    // Leaving the window or the app writes at once: a phone may stop it in the background.
    const view = doc.defaultView
    if (view) {
      // Work whose write failed waits for the person's own Retry or Discard: a write on the way
      // out, as a phone's menu sheet takes the window's focus, would choose for them.
      const leave = (): void => {
        if (this.writeFailed !== this.ports.document()) void this.flush()
      }
      view.addEventListener('blur', leave)
      this.off.push(() => view.removeEventListener('blur', leave))
      const hidden = (): void => {
        if (doc.visibilityState === 'hidden' && this.writeFailed !== this.ports.document())
          void this.flush()
      }
      doc.addEventListener('visibilitychange', hidden)
      this.off.push(() => doc.removeEventListener('visibilitychange', hidden))
    }
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
  /** The last write of this document failed and its work waits for Retry or Discard. */
  get writeFailing(): boolean {
    return !!this.writeFailed && this.writeFailed === this.ports.document()
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
        // A connection or line drawn with its tool, the hand goes back to picking, as in
        // Excalidraw and tldraw: the next press picks what was just drawn.
        if (
          (op.op === 'connect' || op.op === 'add_line') &&
          ['connect', 'line', 'arrow'].includes(this.tool)
        )
          this.tool = 'select'
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
  /**
   * Where something new of this size goes: the free place nearest the middle of what is shown,
   * clear of every card there, so a note inserted on a small screen never lands on a card.
   */
  private location(width = 260, height = 160): { x: number; y: number } {
    const region = this.viewer.visible(),
      graph = this.ports.document()?.session.graph,
      gap = 24,
      cx = region.x + region.width / 2 - width / 2,
      cy = region.y + region.height / 2 - height / 2
    const taken = (x: number, y: number) =>
      !!graph?.nodes.some(
        (n) =>
          n.type !== 'group' &&
          x < n.x + n.width + gap &&
          x + width + gap > n.x &&
          y < n.y + n.height + gap &&
          y + height + gap > n.y
      )
    // Whole in the view, clear of the tools across its top, with a margin at the edges.
    const margin = 16 / this.viewer.camera.zoom,
      top = region.y + this.viewer.insetTop / this.viewer.camera.zoom + margin,
      fits = width + 2 * margin <= region.width && height + 2 * margin <= region.height,
      shown = (x: number, y: number) =>
        !fits ||
        (x >= region.x + margin &&
          y >= top &&
          x + width <= region.x + region.width - margin &&
          y + height <= region.y + region.height - margin)
    // Rings of places round the middle, nearest first.
    const step = Math.max(40, Math.min(width, height) / 2)
    let best: { x: number; y: number } | null = null
    for (let ring = 0; ring <= 24 && !best; ring++)
      for (let i = -ring; i <= ring && !best; i++)
        for (const [dx, dy] of [
          [i, -ring],
          [i, ring],
          [-ring, i],
          [ring, i],
        ]) {
          const x = Math.round(cx + dx * step),
            y = Math.round(cy + dy * step)
          if (!taken(x, y) && shown(x, y)) {
            best = { x, y }
            break
          }
        }
    return best ?? { x: Math.round(cx), y: Math.round(cy) }
  }
  private addText(shape?: Shape, at?: Rect): void {
    const document = this.ready(),
      id = nanoid(),
      place = at ?? { ...this.location(260, 160), width: 260, height: 160 },
      parent = frameAround(document.session.graph, place)
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
          ...place,
          // Put down inside a frame, it is in that frame.
          ...(parent ? { parent } : {}),
        },
      },
    ])
    this.selected = new Set([id])
    this.tool = 'select'
    this.palette.hidden = true
    this.showText(id)
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
  /** The field's text goes into the open draft at once; it is written after a pause. */
  private input(): void {
    if (!this.applyText()) return
    if (this.composing) return
    const now = Date.now(),
      schedule = this.ports.textSchedule ?? CANVAS_TEXT_SCHEDULE,
      view = this.viewer.el.ownerDocument.defaultView
    this.textFirst ??= now
    if (this.textTimer !== null) view.clearTimeout(this.textTimer)
    const delay = Math.max(0, Math.min(schedule.idle, this.textFirst + schedule.max - now))
    this.textTimer = view.setTimeout(() => {
      this.textTimer = null
      void this.saveText()
    }, delay)
  }
  private applyText(): boolean {
    if (!this.editing || !this.ownedDraft || this.ports.document() !== this.ownedDraft) return false
    try {
      this.update(this.ownedDraft, [
        { op: 'update', id: this.editing, patch: { text: this.text.value } },
      ])
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }
  private clearText(): void {
    if (this.textTimer !== null)
      this.viewer.el.ownerDocument.defaultView.clearTimeout(this.textTimer)
    this.textTimer = null
    this.textFirst = null
  }
  /**
   * The text typed so far becomes one undo step, and editing goes on in a new draft of the same
   * card. An unchanged text adds no step, so it neither writes nor clears redo.
   */
  private settleText(): CanvasEditorDocument | null {
    const document = this.ownedDraft
    if (
      !this.editing ||
      this.composing ||
      !document ||
      this.ports.document() !== document ||
      !document.session.draft?.active
    )
      return null
    this.clearText()
    this.applyText()
    try {
      document.finishDraft()
    } catch (error) {
      this.fail(error)
      return null
    }
    try {
      document.beginDraft()
    } catch (error) {
      // The card cannot stay open (another writer is landing); what was typed is kept.
      this.editing = null
      this.ownedDraft = null
      this.text.blur()
      this.fail(error)
    }
    this.changed(document)
    return document
  }
  /** Typing paused or the field was left: write the text now, keep the card open. */
  private async saveText(): Promise<void> {
    if (this.waiting || this.destroyed) return
    if (this.settleText()) await this.flush()
  }
  /** Ends text editing: the text is one last step, if it changed since the previous one. */
  private endText(): CanvasEditorDocument | null {
    if (!this.editing) return null
    this.clearText()
    this.applyText()
    const document = this.ownedDraft
    this.editing = null
    this.ownedDraft = null
    this.composing = false
    try {
      if (document?.session.draft?.active) document.finishDraft()
    } catch (error) {
      this.fail(error)
    }
    const doc = this.text.ownerDocument,
      had = doc.activeElement === this.text
    this.text.blur()
    // The keys go back to the canvas, so the next letter takes a tool rather than going nowhere.
    if (had || doc.activeElement === doc.body) this.viewer.el.focus({ preventScroll: true })
    if (document) this.changed(document)
    else this.refresh()
    return document
  }
  private async finishText(): Promise<void> {
    if (this.waiting || this.composing) return
    const document = this.endText()
    if (document && this.ports.document() === document && !this.destroyed) await this.flush()
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
      this.commit(this.ready(), [op])
    } catch (error) {
      for (const lost of [op, ...this.held.splice(0)])
        if (lost.op === 'add_ink') this.inputAdapter.released(lost.stroke.id)
      return this.fail(error)
    }
    this.inputAdapter.released(op.stroke.id)
    if (this.held.length) void this.addHeld()
  }
  private async retry(): Promise<void> {
    const document = this.ports.document()
    if (!document || this.waiting || !this.writable(document)) return
    await this.flush()
  }
  private async pick(kind: 'file' | 'link'): Promise<void> {
    const original = this.ready(),
      path = original.file.path
    let value: string | null = null
    await this.saving(async () => {
      value = await (kind === 'file' ? this.ports.pickFile() : this.ports.pickLink())
    })
    if (!value) return
    const document = this.ports.document()
    if (original.file.path !== path || document?.file.path !== path)
      throw new Error('Canvas changed while the picker was open; pick again')
    // The picker carries only a new card, not a snapshot to replay. Saves and reloads can
    // advance the generation; build on the current graph after checking it is still editable.
    this.ready()
    const node: NodeInput = {
      id: nanoid(),
      kind: kind === 'file' ? 'note' : 'link',
      ...this.location(),
      ...(kind === 'file' ? { file: value } : { url: value }),
    }
    this.commit(document, [{ op: 'add_node', node }])
    this.selected = new Set([node.id])
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
    // The new card stands clear of the tools, so its words can be written in view.
    this.viewer.reveal({ ...at, ...size })
    if (kind !== 'note') this.editText()
    else this.refresh()
  }
  private async act(action: CanvasAction): Promise<void> {
    const graph = this.ports.document()?.session.graph
    if (!graph || !this.selected.size) return
    const picked = graph.nodes.filter((n) => this.selected.has(n.id))
    if (action === 'copy') {
      await this.copy()
      return
    }
    if (action === 'turn-into-note') return this.turnIntoNote()
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
      // A copy of what is picked, frames with what is inside them and the connections among
      // them, standing beside it to the right, so a copied frame never lands on its original.
      const clip = clipOf(graph, this.selected),
        box = this.picked().rect
      if (!box) return
      const copy = copyOps(clip, box.width + COPY_GAP, 0)
      ops = copy.ops
      after = copy.picked
    }
    if (!ops.length) return
    this.commit(document, ops)
    if (after) this.selected = after
    this.refresh()
  }
  /** One change to one card, as a step of its own; one that changes nothing is no step. */
  private async patchNode(id: string, patch: Record<string, unknown>): Promise<void> {
    const document = this.ready(),
      ops: CanvasOperation[] = [{ op: 'update', id, patch }]
    if (
      canvasFingerprint(editCanvas(document.session.graph, ops).graph) ===
      canvasFingerprint(document.session.graph)
    )
      return this.refresh()
    this.commit(document, ops)
  }

  /** Renames, folds or unfolds one frame as a single step to undo. */
  private async frameOp(
    id: string,
    action: 'rename' | 'collapse' | 'expand',
    label?: string
  ): Promise<void> {
    if (action === 'rename') {
      this.naming = null
      this.regainKeys()
      // The name's field closes, and the frame's bar comes back over it, before the name is saved.
      this.refresh()
    }
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
      this.clearText()
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
    if (this.editing) this.endText()
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
    const rect = rects.length ? bounds(rects) : null
    let anchor = rect
    if (this.selected.size === 1) {
      // One connection or line: the bar stands at its label, in the middle of the line.
      const id = [...this.selected][0],
        edge = graph.edges.find((e) => e.id === id),
        line = edge ? undefined : linesOf(graph).find((l) => l.id === id)
      const mid = edge
        ? labelPoint(paintedRoute(edge, graph), edge.abele?.labelPosition)
        : line
          ? { x: (line.from.x + line.to.x) / 2, y: (line.from.y + line.to.y) / 2 }
          : null
      if (mid) anchor = { x: mid.x, y: mid.y - 14, width: 0, height: 22 }
    }
    return { ids: [...this.selected], kinds, rect, anchor }
  }
  refresh(syncProperties = true): void {
    if (this.destroyed) return
    this.inputAdapter?.validate()
    // What is in hand, for what the cards let through: with a pen nothing in a card answers.
    this.viewer.el.dataset.canvasTool = this.tool
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
    this.viewer.writingLabel = this.labelling
    this.viewer.draw()
    if (document && this.flushHook?.document !== document) {
      // The store writes this document's unwritten work before anyone else reads or writes it.
      if (this.flushHook && this.flushHook.document.writes === this.flushHook)
        this.flushHook.document.writes = null
      this.flushHook = {
        document,
        flush: () => {
          // A reader or a closing tab gets the text typed so far, too.
          if (this.ownedDraft === document) this.settleText()
          return this.writes.flush(document)
        },
      }
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
      'Add a picture',
      'Edit card text',
      'Open selected card',
      'Delete selected card',
      'Toggle multiple selection',
      'Group selected cards',
      'Ungroup selected group',
    ])
      this.buttons.get(label).hidden = !this.inkControls.hidden || active
    // While card text is typed these are disabled anyway. Folding them gives a phone's keyboard
    // back the canvas, which is what a tap ends the typing on (there is no Save button).
    this.buttons.get('Canvas drawing tools').hidden = active
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
      syncProperties &&
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
    for (const label of [
      'Add text card',
      'Add note or attachment',
      'Add link',
      'Add a picture',
      'Add canvas shape',
    ])
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
    this.panel.hidden = !active
    const retry = this.buttons.get('Retry save'),
      discard = this.buttons.get('Discard local draft')
    // A live gesture is a preview, not retained work to retry/discard. On a narrow screen
    // these extra buttons wrap and move the stage underneath the captured pointer.
    // Text being typed is written as it goes, so a failed write offers Retry while typing too.
    retry.hidden =
      !!this.geometry || !retained || !!document?.recovery || !!session?.publicationOutcome
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
      this.naming ||
      this.labelling ||
      event.isComposing ||
      (event.target instanceof Element && event.target.closest('button'))
    )
      return false
    if (event.key === ' ' && this.viewer.step === null) {
      // Held Space is the hand, whatever tool is in hand, as in every drawing app.
      if (!this.spaceHeld) {
        this.spaceHeld = true
        this.viewer.stage.classList.add('is-panning')
        this.refresh()
      }
      event.preventDefault()
      return true
    }
    if (event.key === 'Escape' && this.viewer.step === null) {
      this.inputAdapter.cancel()
      this.selected.clear()
      this.tool = 'select'
      this.refresh()
      event.preventDefault()
      return true
    }
    let label: string | null = null
    if (event.key === 'Enter' && this.node()?.type === 'group') {
      this.naming = this.node().id
      this.refresh()
      event.preventDefault()
      return true
    } else if (event.key === 'Enter' && this.connection()) {
      this.labelling = this.connection().id
      this.refresh()
      event.preventDefault()
      return true
    } else if (event.key === 'Enter') label = 'Edit card text'
    const command = label ? null : canvasKey(event, this.tool)
    if (!label && !command) return false
    // With nothing picked, or a walkthrough running, the arrows go through its steps.
    if (command?.kind === 'nudge' && (!this.selected.size || this.viewer.step !== null))
      return false
    event.preventDefault()
    event.stopPropagation()
    if (label) {
      this.buttons.get(label)?.click()
      return true
    }
    const run = (work: () => unknown) => {
      try {
        void Promise.resolve(work()).catch((error) => this.fail(error))
      } catch (error) {
        this.fail(error)
      }
    }
    switch (command.kind) {
      case 'tool': {
        const tool = command.tool
        if (tool === 'note') this.buttons.get('Add note or attachment')?.click()
        else if (tool === 'shape' && this.tool === 'shape') {
          // R again steps through the shapes, the slot wearing each in turn.
          const at = SHAPES.indexOf(this.shape.value as Shape)
          this.shape.value = SHAPES[(at + 1) % SHAPES.length]
          this.refresh()
        } else this.useTool(tool)
        break
      }
      case 'undo':
        this.buttons.get('Undo canvas change')?.click()
        break
      case 'redo':
        this.buttons.get('Redo canvas change')?.click()
        break
      case 'delete':
        this.buttons
          .get(
            this.buttons.get('Delete selected card')?.disabled
              ? 'Delete canvas selection'
              : 'Delete selected card'
          )
          ?.click()
        break
      case 'select-all': {
        const graph = this.ports.document()?.session.graph
        if (!graph) break
        this.selected = new Set([
          ...canvasVisibility(graph).visible.map((n) => n.id),
          ...graph.edges.map((e) => e.id),
          ...linesOf(graph).map((l) => l.id),
          ...inkEntries(graph)
            .filter((e) => !e.node)
            .map((e) => e.stroke.id),
        ])
        this.refresh()
        break
      }
      case 'duplicate':
        run(() => this.act('duplicate'))
        break
      case 'copy':
        run(() => this.copy())
        break
      case 'cut':
        run(async () => {
          if (await this.copy()) await this.remove()
        })
        break
      case 'front':
      case 'back':
        run(() => this.act(command.kind as 'front' | 'back'))
        break
      case 'fit':
        this.viewer.fit()
        break
      case 'fit-selection': {
        const rect = this.picked().rect
        if (rect) this.viewer.focusRegion(rect, true)
        break
      }
      case 'nudge':
        run(() => this.nudge(command.dx, command.dy))
        break
      case 'find':
        this.finding = true
        this.refresh()
        break
    }
    return true
  }
  /**
   * A text card's words become a note of their own, and the card the live note, in the same place
   * with the same connections: one step to undo on the canvas, the note itself left in the vault.
   */
  private async turnIntoNote(): Promise<void> {
    const node = this.node()
    if (node?.type !== 'text' || node.styleAttributes?.shape || !this.ports.createNote) return
    const text = node.text ?? ''
    const first = text
      .split('\n')
      .map((l) =>
        l
          .replace(/^[#>*\-\s]+/, '')
          .replace(/[*_`[\]]/g, '')
          .trim()
      )
      .find(Boolean)
    const name =
      (first ?? 'Untitled')
        .replace(/[\\/:*?"<>|#^]/g, ' ')
        .slice(0, 60)
        .trim() || 'Untitled'
    const file = await this.ports.createNote(name, text)
    if (!file) return
    await this.apply([
      { op: 'update', id: node.id, patch: { type: 'file', file, text: undefined } },
    ])
  }
  /**
   * After writing a name or a label the keys go back to the canvas, so the next Cmd+Z or letter
   * works at once; unless the keys have moved somewhere else on purpose.
   */
  private regainKeys(): void {
    // Looked at once the focus has settled: a click into another field during a blur has not
    // moved the focus yet.
    window.setTimeout(() => {
      const doc = this.viewer.el.ownerDocument,
        active = doc.activeElement
      if (this.destroyed || this.naming || this.labelling || this.editing) return
      const field = active?.closest?.('input,textarea,[contenteditable=true]')
      if (!active || active === doc.body || (this.viewer.el.contains(active) && !field))
        this.viewer.el.focus({ preventScroll: true })
    }, 0)
  }
  /** One thing picked and brought into view, at the zoom it is read at. */
  private show(id: string): void {
    const graph = this.ports.document()?.session.graph
    if (!graph) return
    this.selected = new Set([id])
    this.refresh()
    const rect = this.picked().rect
    if (!rect) return
    const v = this.viewer.visible()
    if (this.viewer.camera.zoom < 0.6 || rect.width > v.width || rect.height > v.height)
      this.viewer.focusRegion(
        { x: rect.x - 200, y: rect.y - 200, width: rect.width + 400, height: rect.height + 400 },
        true
      )
    else this.viewer.reveal(rect, { top: 120, bottom: 48, side: 48 })
  }
  private useTool(tool: CanvasInputTool): void {
    this.inputAdapter.cancel()
    if (['pen', 'marker', 'eraser', 'partial-eraser', 'lasso'].includes(tool)) this.selected.clear()
    this.tool = tool
    this.multiple = false
    this.refresh()
  }
  /** Picked things moved by an arrow key: one step to undo each press. */
  private async nudge(dx: number, dy: number): Promise<void> {
    const graph = this.ports.document()?.session.graph
    if (!graph) return
    // Connections follow their cards and cannot move on their own.
    const ids = [...this.selected].filter((id) => !graph.edges.some((e) => e.id === id))
    if (!ids.length) return
    await this.apply([{ op: 'move', ids, dx, dy }])
  }
  /** One batch of edits as one step to undo, published at once. */
  private async apply(ops: CanvasOperation[], select?: Set<string>): Promise<void> {
    const document = this.ready()
    if (!ops.length) return
    if (
      canvasFingerprint(editCanvas(document.session.graph, ops).graph) ===
      canvasFingerprint(document.session.graph)
    )
      return this.refresh()
    this.commit(document, ops)
    if (select) this.selected = select
    this.refresh()
  }
  /** The picked things on the clipboard, as Obsidian Canvas's own JSON, so it pastes anywhere. */
  private async copy(): Promise<boolean> {
    const graph = this.ports.document()?.session.graph
    if (!graph || !this.selected.size) return false
    const clip = clipOf(graph, this.selected),
      count =
        clip.nodes.length +
        clip.edges.length +
        linesOf(clip).length +
        (Array.isArray(clip.abele?.ink) ? clip.abele.ink.length : 0)
    const text = JSON.stringify(clip, null, '\t')
    this.clipboard = text
    await this.viewer.el.ownerDocument.defaultView?.navigator.clipboard
      ?.writeText(text)
      .catch(() => {})
    this.ports.notice(`Copied ${count} to the clipboard`)
    return true
  }
  /** What was copied, kept here too, for a clipboard the page may not read back. */
  private clipboard = ''
  /** Copies of picked things carried with Alt: they stand where they were let go. */
  private async copyBy(ids: ReadonlySet<string>, dx: number, dy: number): Promise<void> {
    const graph = this.ports.document()?.session.graph
    if (!graph) return
    const copy = copyOps(clipOf(graph, ids), dx, dy)
    await this.apply(copy.ops, copy.picked)
  }
  /** Where something pasted or dropped lands: at the pointer, else in the middle of the view. */
  /**
   * Pictures chosen from this device, saved beside the canvas's attachments as a pasted one is,
   * each a card at the middle of what is in sight.
   */
  private pickPictures(): void {
    const input = this.viewer.el.ownerDocument.win.createEl('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    // In the page while it is open: a detached field can lose the choice on some WebKit builds.
    input.className = 'abele-canvas-picture-input'
    input.hidden = true
    this.viewer.el.append(input)
    const done = () => input.remove()
    input.addEventListener('cancel', done)
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? [])
      done()
      if (!files.length) return
      const v = this.viewer.visible()
      void this.place(files, '', [v.x + v.width / 2, v.y + v.height / 2]).catch((error) =>
        this.fail(error)
      )
    })
    input.click()
  }
  private landing(): [number, number] {
    if (this.pointerAt) {
      const v = this.viewer.visible(),
        [x, y] = this.pointerAt
      if (x >= v.x && y >= v.y && x <= v.x + v.width && y <= v.y + v.height) return [x, y]
    }
    const v = this.viewer.visible()
    return [v.x + v.width / 2, v.y + v.height / 2]
  }
  private async paste(event: ClipboardEvent): Promise<void> {
    const target = event.target as HTMLElement | null
    if (
      this.editing ||
      this.naming ||
      this.labelling ||
      target?.closest?.('input,textarea,[contenteditable=true]') ||
      !event.clipboardData
    )
      return
    const data = event.clipboardData,
      files = Array.from(data.files),
      text = data.getData('text/plain')
    if (!files.length && !text && !this.clipboard) return
    event.preventDefault()
    try {
      await this.place(files, text || this.clipboard, this.landing())
    } catch (error) {
      this.fail(error)
    }
  }
  private async dropIn(event: DragEvent): Promise<void> {
    if (!event.dataTransfer || !this.canGesture()) return
    event.preventDefault()
    const r = this.viewer.stage.getBoundingClientRect(),
      cam = this.viewer.camera,
      at: [number, number] = [
        (event.clientX - r.left) / cam.zoom + cam.x,
        (event.clientY - r.top) / cam.zoom + cam.y,
      ]
    const paths = this.ports.droppedPaths?.(event) ?? []
    try {
      if (paths.length) await this.addFiles(paths, at)
      else
        await this.place(
          Array.from(event.dataTransfer.files),
          event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain'),
          at
        )
    } catch (error) {
      this.fail(error)
    }
  }
  /**
   * Files become cards of their own, saved beside the canvas's attachments first; a copy of
   * canvas cards lands with its middle at the point; a web address becomes a link card, and
   * other words a text card.
   */
  private async place(files: File[], text: string, at: [number, number]): Promise<void> {
    // Whole units, as everything put down by hand is.
    const x = Math.round(at[0]),
      y = Math.round(at[1])
    if (files.length) {
      if (!this.ports.saveAttachment) throw new Error('Files cannot be saved here')
      const paths: string[] = [],
        sizes: { width: number; height: number }[] = []
      for (const file of files) {
        const data = await file.arrayBuffer()
        const ext = PICTURE_TYPES[file.type]
        const name =
          file.name && file.name !== 'image.png'
            ? file.name
            : `Pasted image ${stamp()}.${ext ?? 'png'}`
        const path = await this.ports.saveAttachment(name, data)
        if (!path) continue
        paths.push(path)
        sizes.push(ext ? await pictureDimensions(data, file.type) : { width: 320, height: 240 })
      }
      return this.addFiles(paths, [x, y], sizes)
    }
    const clip = parseClip(text)
    if (clip && clip.nodes.length + (clip.abele ? 1 : 0)) {
      const box = clip.nodes.length ? bounds(clip.nodes) : { x, y, width: 0, height: 0 }
      const copy = copyOps(
        clip,
        Math.round(x - (box.x + box.width / 2)),
        Math.round(y - (box.y + box.height / 2))
      )
      return this.apply(copy.ops, copy.picked)
    }
    const url = pastedUrl(text)
    const id = nanoid()
    const node: NodeInput = url
      ? { id, kind: 'link', url, x: x - 200, y: y - 120, width: 400, height: 240 }
      : {
          id,
          kind: 'text',
          label: text.trim(),
          x: x - CARD_SIZE.width / 2,
          y: y - CARD_SIZE.height / 2,
          ...CARD_SIZE,
        }
    if (!url && !text.trim()) return
    return this.apply([{ op: 'add_node', node }], new Set([id]))
  }
  /** Files from the vault as cards side by side, the first with its middle at the point. */
  private async addFiles(
    paths: string[],
    [x, y]: [number, number],
    sizes: { width: number; height: number }[] = []
  ): Promise<void> {
    if (!paths.length) return
    let left = Math.round(x - (sizes[0]?.width ?? 320) / 2)
    const ops: CanvasOperation[] = [],
      ids = new Set<string>()
    paths.forEach((file, i) => {
      const size =
        sizes[i] ??
        (/\.md$/i.test(file) ? { width: 400, height: 400 } : { width: 320, height: 240 })
      const id = nanoid()
      ids.add(id)
      ops.push({
        op: 'add_node',
        node: { id, kind: 'note', file, x: left, y: Math.round(y - size.height / 2), ...size },
      })
      left += size.width + 40
    })
    await this.apply(ops, ids)
  }
  /** A double click or double tap: write in the card, on the line or in the frame's name; on
   * empty canvas, or empty space inside a frame, a new card there. */
  /** A field focused while the touch is still being handled, so a phone raises its keyboard. */
  private primer: HTMLTextAreaElement | null = null
  /**
   * iOS raises its keyboard only for a field focused during the touch itself; a label or a
   * frame's name is drawn a moment later. Focus moves on to it from this one with the keyboard up.
   */
  private primeKeyboard(): void {
    if (!this.primer) {
      const el = this.viewer.el.ownerDocument.createElementNS(
        'http://www.w3.org/1999/xhtml',
        'textarea'
      ) as HTMLTextAreaElement
      el.className = 'abele-canvas-keyboard-primer'
      el.setAttribute('aria-hidden', 'true')
      el.tabIndex = -1
      this.viewer.el.append(el)
      this.off.push(() => el.remove())
      this.primer = el
    }
    this.primer.focus({ preventScroll: true })
  }
  private doubleTap(event: PointerEvent): void {
    const document = this.ports.document()
    if (
      !document ||
      this.waiting ||
      this.editing ||
      this.naming ||
      this.labelling ||
      this.spaceHeld ||
      this.tool !== 'select' ||
      !this.canGesture()
    )
      return
    const doc = this.viewer.el.ownerDocument
    const label = (doc.elementsFromPoint?.(event.clientX, event.clientY) ?? [])
      .map((el) => el.closest<HTMLElement>('[data-frame-id]'))
      .find(Boolean)
    if (label?.dataset.frameId) {
      this.selected = new Set([label.dataset.frameId])
      this.naming = label.dataset.frameId
      this.primeKeyboard()
      return this.refresh()
    }
    const r = this.viewer.stage.getBoundingClientRect(),
      cam = this.viewer.camera,
      x = (event.clientX - r.left) / cam.zoom + cam.x,
      y = (event.clientY - r.top) / cam.zoom + cam.y,
      graph = document.session.graph,
      node = hitNode(graph, x, y)
    if (!node || node.type === 'group') {
      const line = connectionAt(
        graph,
        { x, y },
        (event.pointerType === 'mouse' ? 10 : 22) / cam.zoom
      )
      if (line) {
        this.selected = new Set([line])
        this.labelling = line
        this.primeKeyboard()
        return this.refresh()
      }
    }
    if (node && node.type === 'text') {
      this.selected = new Set([node.id])
      this.refresh()
      return this.editText()
    }
    if (node && node.type !== 'group') return
    try {
      const rect = {
        x: Math.round(x - CARD_SIZE.width / 2),
        y: Math.round(y - CARD_SIZE.height / 2),
        ...CARD_SIZE,
      }
      this.addText(undefined, rect)
      this.viewer.reveal(rect)
    } catch (error) {
      this.fail(error)
    }
  }
  /** The wheel over a picked note reads on inside its card, until its words run out. */
  private wheel(event: WheelEvent): boolean {
    const r = this.viewer.stage.getBoundingClientRect(),
      cam = this.viewer.camera,
      x = (event.clientX - r.left) / cam.zoom + cam.x,
      y = (event.clientY - r.top) / cam.zoom + cam.y,
      graph = this.ports.document()?.session.graph
    const node = graph && hitNode(graph, x, y)
    if (!node || !this.selected.has(node.id) || node.type === 'group') return false
    const body = this.viewer.scroller(node.id)
    if (!body || body.scrollHeight <= body.clientHeight + 8) return false
    const dy = (event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY) / cam.zoom,
      before = body.scrollTop
    body.scrollTop = before + dy
    return body.scrollTop !== before || Math.abs(dy) < 1
  }
  private async saveLabel(id: string, label: string): Promise<void> {
    this.labelling = null
    this.regainKeys()
    const graph = this.ports.document()?.session.graph,
      element =
        graph?.edges.find((e) => e.id === id) ??
        linesOf(graph ?? { nodes: [], edges: [] }).find((l) => l.id === id)
    if (!element || (element.label ?? '') === label.trim()) return this.refresh()
    await this.apply([{ op: 'update', id, patch: { label: label.trim() } }])
  }
  private async showPart(id: string, subpath: string): Promise<void> {
    await this.apply([{ op: 'update', id, patch: { subpath: subpath || undefined } }])
  }
  private async addPart(id: string, subpath: string): Promise<void> {
    const node = this.ports.document()?.session.graph.nodes.find((n) => n.id === id)
    if (!node?.file) return
    const fresh = nanoid()
    await this.apply(
      [
        {
          op: 'add_node',
          node: {
            id: fresh,
            kind: 'note',
            file: node.file,
            ...(subpath ? { subpath } : {}),
            x: node.x + node.width + 60,
            y: node.y,
            width: node.width,
            height: Math.min(node.height, 300),
          },
        },
      ],
      new Set([fresh])
    )
  }
  destroy(): void {
    void this.close()
  }
  /** Closing writes what is only in memory. Resolves false when some of it could not be written. */
  close(): Promise<boolean> {
    if (this.destroyed) return Promise.resolve(true)
    const document = this.ports.document()
    this.inputAdapter.destroy()
    if (this.ownedDraft === document) this.endText()
    this.clearText()
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

/** A picture's own size, read from its bytes by the browser, scaled to a card. */
async function pictureDimensions(
  data: ArrayBuffer,
  type: string
): Promise<{ width: number; height: number }> {
  if (typeof URL.createObjectURL !== 'function') return pictureSize(0, 0)
  const url = URL.createObjectURL(new Blob([data], { type }))
  try {
    const size = await new Promise<{ width: number; height: number }>((resolve) => {
      const image = new Image()
      const timer = window.setTimeout(() => resolve({ width: 0, height: 0 }), 3000)
      image.onload = () => {
        window.clearTimeout(timer)
        resolve({ width: image.naturalWidth, height: image.naturalHeight })
      }
      image.onerror = () => {
        window.clearTimeout(timer)
        resolve({ width: 0, height: 0 })
      }
      image.src = url
    })
    return pictureSize(size.width, size.height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The local time as Obsidian names a pasted picture: 20261015093042. */
function stamp(): string {
  const d = new Date(),
    two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
}
