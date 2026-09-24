/**
 * The mermaid viewer in Live Preview.
 *
 * Obsidian draws a mermaid block in the editor as a widget of its own, and it decides that
 * before any plugin's code-block processor is consulted, so the reading-view route does not
 * reach it. This field draws the block instead: a block widget over the whole fenced block,
 * at the highest precedence, so Obsidian's widget for the same lines is never drawn — and never
 * spends a render on a diagram nobody sees.
 *
 * It behaves as Obsidian's does: with the cursor or a selection anywhere in the block, the
 * block is shown as source to edit, and the diagram comes back when the cursor leaves. The
 * viewer's own "edit" control puts the cursor there.
 */
import { Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { editorInfoField, editorLivePreviewField, type App } from 'obsidian'
import { findMermaidFences } from '@/mermaid/mermaidSource'
import { mermaidViewerActive } from '@/mermaid/mermaidGate'
import { mountMermaid } from '@/mermaid/mermaidBlocks'
import { GlobalStore } from '@/stores/GlobalStore'

/** Makes every editor ask again whether the viewer is on — after the setting or trust changes. */
export const refreshMermaid = StateEffect.define<null>()

const disposers = new WeakMap<HTMLElement, () => void>()

export class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly sourcePath: string
  ) {
    super()
  }

  eq(other: MermaidWidget): boolean {
    return other.source === this.source && other.sourcePath === this.sourcePath
  }

  toDOM(view: EditorView): HTMLElement {
    const host = view.dom.doc.win.createDiv({ cls: 'abele-mermaid-host abele-mermaid-host_editor' })
    const dispose = mountMermaid(host, {
      source: this.source,
      sourcePath: this.sourcePath,
      edit: () => revealSource(view, host),
    })
    disposers.set(host, dispose)
    return host
  }

  destroy(dom: HTMLElement): void {
    disposers.get(dom)?.()
    disposers.delete(dom)
  }

  /** Roughly a diagram's frame, so the scrollbar does not jump when one is drawn. */
  get estimatedHeight(): number {
    return 320
  }

  /** The frame's drags, wheel and keys are the viewer's, not the editor's. */
  ignoreEvent(): boolean {
    return true
  }
}

/** Cursor to the end of the opening fence: inside the block, so it opens as source. */
function revealSource(view: EditorView, host: HTMLElement): void {
  const line = view.state.doc.lineAt(view.posAtDOM(host))
  view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true })
  view.focus()
}

interface Block {
  from: number
  to: number
  source: string
}

interface MermaidState {
  active: boolean
  blocks: Block[]
  decorations: DecorationSet
}

function findBlocks(state: EditorState): Block[] {
  const lines = state.doc.toString().split('\n')
  return findMermaidFences(lines).map((fence) => ({
    from: state.doc.line(fence.startLine + 1).from,
    to: state.doc.line(fence.endLine + 1).to,
    source: fence.source,
  }))
}

function decorate(state: EditorState, blocks: Block[]): DecorationSet {
  const sourcePath = state.field(editorInfoField, false)?.file?.path ?? ''
  const touched = (block: Block) =>
    state.selection.ranges.some((range) => range.from <= block.to && range.to >= block.from)
  return Decoration.set(
    blocks
      .filter((block) => !touched(block))
      .map((block) =>
        Decoration.replace({
          widget: new MermaidWidget(block.source, sourcePath),
          block: true,
        }).range(block.from, block.to)
      )
  )
}

function compute(
  state: EditorState,
  isActive: () => boolean,
  previous?: MermaidState
): MermaidState {
  const active = !!state.field(editorLivePreviewField, false) && isActive()
  if (!active) return { active, blocks: [], decorations: Decoration.none }
  const blocks = previous?.active ? previous.blocks : findBlocks(state)
  return { active, blocks, decorations: decorate(state, blocks) }
}

/**
 * @param isActive whether the viewer should draw at all; the plugin passes the setting and
 *   Obsidian's trust in the vault, tests pass what they are testing.
 */
export function mermaidEditorExtension(isActive: () => boolean): Extension {
  const field = StateField.define<MermaidState>({
    create: (state) => compute(state, isActive),
    update(value, tr) {
      const refreshed = tr.effects.some((effect) => effect.is(refreshMermaid))
      const modeChanged =
        tr.state.field(editorLivePreviewField, false) !==
        tr.startState.field(editorLivePreviewField, false)
      if (refreshed || modeChanged) return compute(tr.state, isActive)
      if (tr.docChanged) return compute(tr.state, isActive, { ...value, active: false })
      if (tr.selection) return value.active ? compute(tr.state, isActive, value) : value
      return value
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
  })
  return Prec.highest(field)
}

export const mermaidExtensions = (): Extension =>
  mermaidEditorExtension(() => mermaidViewerActive(GlobalStore.getInstance().app))

/** Tells every open editor to look again at whether the viewer is on. */
export function refreshMermaidEditors(app: App): void {
  app.workspace.iterateAllLeaves((leaf) => {
    const editor = (leaf.view as { editor?: { cm?: EditorView } }).editor
    editor?.cm?.dispatch({ effects: refreshMermaid.of(null) })
  })
}
