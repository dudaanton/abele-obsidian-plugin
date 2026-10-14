import { setIcon, setTooltip } from 'obsidian'
import { quoteWords } from '@/ai/replyLinks'
import type { ChatReplyTo } from '@/ai/types'

export interface ReplyChipOptions {
  /** Its number among the places of the message, when there are several. */
  number?: number
  /** Its message is not in the branch on screen: the chip stays, faint, and leads nowhere. */
  gone?: boolean
  /** Pressed: the chat goes to the words it answers. */
  onOpen?: () => void
  /** In the composer, a cross takes it out of the text. */
  onRemove?: () => void
}

const CHIP = 'abele-reply-chip'

/**
 * One place of the agent's words, standing in a question's text as a single inline thing: its
 * number, the reply glyph and the words' start in one faint line. The same element in the field
 * where the question is written and in the question once sent, so it reads the same in both.
 */
export function replyChip(doc: Document, to: ChatReplyTo, options: ReplyChipOptions = {}) {
  const make = (cls: string) => doc.win.createSpan({ cls })
  const el = make(CHIP)
  el.contentEditable = 'false'
  el.dataset.replyMessage = to.messageId
  if (options.gone) el.classList.add(`${CHIP}_gone`)
  if (options.number !== undefined) {
    const number = el.appendChild(make(`${CHIP}__number`))
    number.textContent = String(options.number)
  }
  const glyph = el.appendChild(make(`${CHIP}__glyph`))
  glyph.setAttribute('aria-hidden', 'true')
  setIcon(glyph, options.gone ? 'unlink' : 'reply')
  const words = el.appendChild(make(`${CHIP}__words`))
  words.textContent = quoteWords(to.quote)
  setTooltip(
    el,
    options.gone
      ? 'Its message is in another branch of this chat'
      : options.onRemove
        ? 'The agent gets a link to these words, not the words again'
        : 'Go to the words this replies to'
  )
  if (!options.gone && options.onOpen) {
    const open = options.onOpen
    el.setAttribute('role', 'link')
    el.tabIndex = 0
    el.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest(`.${CHIP}__remove`)) return
      event.preventDefault()
      event.stopPropagation()
      open()
    })
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      open()
    })
  }
  if (options.onRemove) {
    const remove = options.onRemove
    const cross = el.appendChild(make(`${CHIP}__remove clickable-icon`))
    cross.setAttribute('role', 'button')
    setIcon(cross, 'x')
    setTooltip(
      cross,
      options.number ? `Do not reply to place ${options.number}` : 'Do not reply to this'
    )
    // Down, not click: the editor would move its cursor first and the press would be lost.
    cross.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      remove()
    })
  }
  return el
}
