import {
  computed,
  onBeforeUnmount,
  ref,
  watch,
  watchEffect,
  type ComponentPublicInstance,
} from 'vue'
import { Menu } from 'obsidian'
import { CommentService } from '@/ai/CommentService'
import { paintMessageComments, selectionAnchor, type PaintedComment } from '@/ai/messageComments'
import type { MessageComment } from '@/ai/types'

type Ask = (quote?: string, start?: number) => void

/**
 * Comments on one answer in a chat, as the message draws them and starts them.
 *
 * Drawing: the answer's rendered markdown gets the note's own quote mark and icon, redrawn
 * after every render and whenever a comment's state, digit or openness changes. Starting: the
 * words selected in the answer when "Ask here" was reached for — from the message's actions or
 * from the menu of the selection — or the whole answer when nothing was selected.
 *
 * The selection is taken when the pointer goes *down* on the way to "Ask here": by the click a
 * phone has already let it go. What the press on the message's icon found is kept for the
 * action row it opens, which is where a phone's "Ask here" is.
 */
export function useMessageComments(comments: () => MessageComment[] | undefined, ask: Ask) {
  const content = ref<ComponentPublicInstance | null>(null)
  const root = (): HTMLElement | null => (content.value?.$el as HTMLElement | undefined) ?? null

  const service = CommentService.getInstance()

  /** What each comment's icon says now — reactive through the comment sessions. */
  const painted = computed<PaintedComment[]>(() =>
    (comments() ?? [])
      // A comment whose file has gone opens nothing; it is not drawn.
      .filter((comment) => !service.isMissing(comment.id))
      .map((comment) => {
        const info = service.get(comment.id)
        return {
          id: comment.id,
          quote: comment.quote,
          start: comment.start,
          count: info?.messages ?? 0,
          state: info?.state ?? 'idle',
          open: info?.open ?? false,
        }
      })
  )

  // A comment nobody has read yet is loaded, which is what gives its icon a digit and a state.
  watchEffect(() => {
    const ids = (comments() ?? []).map((comment) => comment.id)
    if (ids.length) service.touch('', ids)
  })

  const paint = () => {
    const el = root()
    if (!el) return
    paintMessageComments(el, painted.value, (id) => service.openFrom([id]))
  }

  watch(painted, paint, { deep: true, flush: 'post' })

  let held: { quote: string; start: number } | null = null

  const current = (): { quote: string; start: number } | null => {
    const el = root()
    const selection = el?.ownerDocument.getSelection()
    if (!el || !selection || selection.isCollapsed || !selection.rangeCount) return null
    return selectionAnchor(el, selection.getRangeAt(0))
  }

  /** On the pointer going down: what is selected in this answer right now, if anything. */
  const capture = () => {
    held = current() ?? held
  }

  /** The press on the message's icon starts over: only what is selected now counts. */
  const captureFresh = () => {
    held = current()
  }

  const askHere = () => {
    const anchor = current() ?? held
    held = null
    ask(anchor?.quote, anchor?.start)
  }

  /** Right-click on selected words of the answer: copy them, or ask about them. */
  const onContentMenu = (event: MouseEvent) => {
    const anchor = current()
    if (!anchor) return
    event.preventDefault()
    const selected = root()?.ownerDocument.getSelection()?.toString() ?? anchor.quote

    const menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle('Copy')
        .setIcon('copy')
        .onClick(() => void navigator.clipboard.writeText(selected))
    )
    menu.addItem((item) =>
      item
        .setTitle('Ask here')
        .setIcon('message-circle-plus')
        .onClick(() => ask(anchor.quote, anchor.start))
    )
    menu.showAtMouseEvent(event)
  }

  onBeforeUnmount(() => {
    held = null
  })

  return { content, paint, capture, captureFresh, askHere, onContentMenu }
}
