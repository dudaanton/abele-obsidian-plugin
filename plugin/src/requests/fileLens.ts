// A `.http` file of the project read as the code it is, with one glyph in the margin at every
// request's method line that sends it, as an IDE's run glyph does, and how it last came back faint
// at the end of that line. The file stays the requests' only copy: nothing is imported.
import { t } from '@/i18n'
import { GutterMarker, gutter, Decoration, EditorView, WidgetType } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import type { InjectionKey, Ref } from 'vue'
import { setIcon, setTooltip } from 'obsidian'

/** One request of the file, where its method line is and how its last sending went. */
export interface FileLensRequest {
  /** 1-based line of the method and address. */
  line: number
  name: string
  sending?: boolean
  last?: { status?: number; failed?: boolean; ms?: number }
}

export interface FileLens {
  requests: FileLensRequest[]
  send(line: number): void
  /** The request's tab, with its answer. */
  open(line: number): void
}

/** What a file view asks for a file it shows: the glyphs, when the file holds requests. */
export const FILE_LENS: InjectionKey<(path: string) => Ref<FileLens | null> | null> =
  Symbol('requests file lens')

const sendLabel = (name: string) => t('requests.capture.sendFirst', { name })

class SendMarker extends GutterMarker {
  constructor(
    readonly request: FileLensRequest,
    readonly lens: FileLens
  ) {
    super()
  }
  eq(other: SendMarker) {
    return other.request === this.request
  }
  toDOM(view: EditorView) {
    const el = view.dom.ownerDocument.win.createEl('button')
    el.type = 'button'
    el.className = 'clickable-icon abele-file-lens__send'
    el.setAttribute('aria-label', sendLabel(this.request.name))
    if (this.request.sending) el.classList.add('is-sending')
    setIcon(el, 'play')
    setTooltip(el, sendLabel(this.request.name))
    el.addEventListener('mousedown', (e) => e.preventDefault())
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!this.request.sending) this.lens.send(this.request.line)
    })
    return el
  }
}

class Outcome extends WidgetType {
  constructor(
    readonly request: FileLensRequest,
    readonly lens: FileLens
  ) {
    super()
  }
  eq(other: Outcome) {
    return other.request === this.request
  }
  toDOM(view: EditorView) {
    const el = view.dom.ownerDocument.win.createSpan()
    const last = this.request.last
    const bad = this.request.sending ? false : !!last?.failed || (last?.status ?? 0) >= 400
    el.className = 'abele-file-lens__outcome' + (bad ? ' is-error' : '')
    el.textContent = this.request.sending
      ? t('requests.file.sending')
      : last?.failed
        ? t('requests.file.notSent')
        : [last?.status, last?.ms !== undefined ? `${last.ms} ms` : ''].filter(Boolean).join(' · ')
    el.setAttribute('role', 'button')
    el.tabIndex = 0
    setTooltip(el, t('requests.file.openAnswer', { name: this.request.name }))
    const open = () => this.lens.open(this.request.line)
    el.addEventListener('mousedown', (e) => e.preventDefault())
    el.addEventListener('click', open)
    el.addEventListener('keydown', (e) => e.key === 'Enter' && open())
    return el
  }
  ignoreEvent() {
    return true
  }
}

export function fileLens(lens: FileLens) {
  const at = new Map(lens.requests.map((r) => [r.line, r]))
  const outcomes = EditorView.decorations.of((view) => {
    const builder = new RangeSetBuilder<Decoration>()
    for (const r of [...lens.requests].sort((a, b) => a.line - b.line)) {
      if (r.line > view.state.doc.lines || (!r.last && !r.sending)) continue
      const end = view.state.doc.line(r.line).to
      builder.add(end, end, Decoration.widget({ widget: new Outcome(r, lens), side: 1 }))
    }
    return builder.finish()
  })
  return [
    gutter({
      class: 'abele-file-lens',
      lineMarker(view, block) {
        const r = at.get(view.state.doc.lineAt(block.from).number)
        return r ? new SendMarker(r, lens) : null
      },
      initialSpacer: () => new SendMarker({ line: 0, name: '' }, lens),
    }),
    outcomes,
  ]
}
