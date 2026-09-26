/**
 * Typing a block of text on a drawing: an ordinary text field laid over the drawing where the
 * block goes, in the block's letters at the size the view shows them, so what is typed is where it
 * will stay. An ordinary field on purpose — on an iPad the pen writes into it and Scribble turns
 * the writing into text, with no work of ours.
 *
 * It stays open while the drawing is moved or zoomed, following its place; it closes, keeping
 * what was typed, when it loses the focus, on Esc, or when another touch lands on the drawing.
 */
import { inkLiteral, type InkColor } from '@/reader/ink/stroke'
import { LINE_HEIGHT, TEXT_FONT } from './items'
import { toScreen, type Camera } from './camera'

const XHTML = 'http://www.w3.org/1999/xhtml'

export interface TextEditing {
  /** Where the block's top left is, in the drawing's units. */
  x: number
  y: number
  size: number
  color: InkColor
}

export class TextEditor {
  readonly el: HTMLTextAreaElement
  private done = false

  constructor(
    parent: HTMLElement,
    private readonly at: TextEditing,
    text: string,
    private camera: Camera,
    private readonly finish: (text: string) => void
  ) {
    this.el = parent.ownerDocument.createElementNS(XHTML, 'textarea') as HTMLTextAreaElement
    this.el.className = 'abele-drawing-text'
    this.el.value = text
    this.el.spellcheck = true
    this.el.setAttribute('aria-label', 'Text on the drawing')
    this.el.setAttribute('rows', '1')
    this.el.addEventListener('input', () => this.fit())
    this.el.addEventListener('blur', () => this.close())
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.close()
      }
    })
    parent.append(this.el)
    this.place(camera)
    this.el.focus()
    const end = this.el.value.length
    this.el.setSelectionRange(end, end)
  }

  get open(): boolean {
    return !this.done
  }

  /**
   * The field's own letter size and how much it is scaled to look the size the drawing shows.
   * Never under 16 px of its own: iOS zooms the whole page into a field with smaller letters.
   */
  private scale(): { font: number; k: number } {
    const shown = this.at.size * this.camera.zoom
    const font = Math.max(16, shown)
    return { font, k: shown / font }
  }

  /** Follows the drawing as it is moved or zoomed. */
  place(camera: Camera): void {
    this.camera = camera
    const [left, top] = toScreen(camera, this.at.x, this.at.y)
    const { font, k } = this.scale()
    this.el.setCssStyles({
      left: `${left}px`,
      top: `${top}px`,
      fontFamily: TEXT_FONT,
      fontSize: `${font}px`,
      lineHeight: String(LINE_HEIGHT),
      color: inkLiteral(this.at.color),
      transformOrigin: '0 0',
      transform: k === 1 ? '' : `scale(${k})`,
    })
    this.fit()
  }

  private fit(): void {
    const { font } = this.scale()
    this.el.setCssStyles({ height: '0px', width: '0px' })
    this.el.setCssStyles({
      height: `${Math.max(this.el.scrollHeight, font * LINE_HEIGHT)}px`,
      width: `${Math.max(this.el.scrollWidth + font, font * 4)}px`,
    })
  }

  /** Keeps what was typed and goes. */
  close(): void {
    if (this.done) return
    this.done = true
    const text = this.el.value.replace(/\s+$/, '')
    this.el.remove()
    this.finish(text)
  }
}
