import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { ChatMessage } from '@/ai/types'
import {
  findInMessages,
  foldQuery,
  sameMatch,
  startingMatch,
  type FindMatch,
  type FindPart,
} from '@/ai/chatFind'
import { createFindPainter, openFolds, textRanges, type FindPainter } from '@/ai/chatFindDom'

/** What the chat lends the finder: its messages, its scroll box, and its ways of moving in it. */
export interface ChatFindHost {
  /** The conversation on screen, oldest first — the branch being read. */
  messages: () => readonly ChatMessage[]
  /** The box the messages scroll in. */
  container: () => HTMLElement | null
  /** How many messages at the start are not mounted. */
  hidden: () => number
  /** Mounts every message from this index on. */
  mountFrom: (index: number) => void
  /** Unfolds whatever keeps a part of a message out of sight. */
  revealPart: (messageId: string, part: FindPart) => void
  /** Keeps an element this far below the top of the box while what is around it settles. */
  holdInView: (el: HTMLElement, offset: number) => void
}

/** How long typing has to pause before the chat is searched again. */
const SEARCH_DELAY_MS = 120
/** How long a burst of changes to the page is let settle before the marks are worked out again. */
const REPAINT_MS = 50
/** How long a match's message is given to draw its markdown before the match is looked for. */
const DRAW_WAIT_MS = 1500
/** Messages mounted before the one a match is in, so it does not sit against the top edge. */
const CONTEXT = 3
/** Where a match brought into view stands: a third of the way down the box. */
const VIEW_AT = 1 / 3
/** How close to an edge of the box a match may be and still count as in view. */
const EDGE_PX = 24

const escapeAttr = (value: string) =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')

/**
 * Find in a chat: the words typed, how many times the conversation holds them, and which one is
 * being shown — counted from the messages themselves, so the ones not mounted and the parts
 * folded away are found too, and shown by mounting and unfolding them when they come up.
 */
export function useChatFind(host: ChatFindHost) {
  const isOpen = ref(false)
  const query = ref('')
  const matches = shallowRef<FindMatch[]>([])
  const index = ref(-1)
  /** Bumped when the bar should take the cursor again: another Cmd+F while it is open. */
  const focusRequest = ref(0)
  /** Whether the bar takes the cursor as it appears. */
  const takesFocus = ref(true)

  const count = computed(() => matches.value.length)
  const current = computed(() => matches.value[index.value] ?? null)

  let typing = 0
  let repaintTimer = 0
  let observer: MutationObserver | null = null
  /** Which showing is the latest, so a slow one that finishes late does not scroll. */
  let showing = 0

  /** This chat's marks, made for the window its box is in — a popped-out one has its own. */
  let painter: FindPainter | null = null
  let painterDoc: Document | null = null
  const painterFor = (doc: Document) => {
    if (painterDoc !== doc) {
      painter?.clear()
      painter = createFindPainter(doc)
      painterDoc = doc
    }
    return painter!
  }
  const unpaint = () => painter?.clear()

  const win = () => host.container()?.ownerDocument.defaultView ?? window

  /** The part elements of one message on the page. */
  const partsOf = (messageId: string, part: FindPart): HTMLElement[] => {
    const box = host.container()
    const el = box?.querySelector(`[data-message-id="${escapeAttr(messageId)}"]`)
    return el ? Array.from(el.querySelectorAll<HTMLElement>(`[data-find-part="${part}"]`)) : []
  }

  /** The range the current match is on the page, if its message is mounted and drawn. */
  const currentRange = (): Range | null => {
    const match = current.value
    const q = foldQuery(query.value)
    if (!match || !q) return null
    const ranges = partsOf(match.messageId, match.part).flatMap((el) => textRanges(el, q))
    // The markdown drawn can hold fewer than the text did — a word inside a link's address.
    return ranges[Math.min(match.nth, ranges.length - 1)] ?? null
  }

  const repaint = () => {
    repaintTimer = 0
    const box = host.container()
    if (!box) return
    const q = foldQuery(query.value)
    if (!isOpen.value || !q) {
      unpaint()
      return
    }
    const all = Array.from(box.querySelectorAll<HTMLElement>('[data-find-part]')).flatMap((el) =>
      textRanges(el, q)
    )
    painterFor(box.ownerDocument).paint(all, currentRange())
  }

  const scheduleRepaint = () => {
    if (repaintTimer) return
    repaintTimer = win().setTimeout(repaint, REPAINT_MS)
  }

  /** Watches the page while the bar is open: a message drawing its markdown, a reply streaming. */
  const observe = () => {
    const box = host.container()
    observer?.disconnect()
    observer = null
    if (!box || !isOpen.value) return
    const Observer = box.ownerDocument.defaultView?.MutationObserver ?? MutationObserver
    observer = new Observer(scheduleRepaint)
    observer.observe(box, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['open'],
    })
  }

  const topMessageId = (): string | null => {
    const box = host.container()
    if (!box) return null
    const top = box.getBoundingClientRect().top
    const first = Array.from(box.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (m) => m.getBoundingClientRect().bottom > top
    )
    return first?.dataset.messageId ?? null
  }

  const wait = (ms: number) => new Promise<void>((resolve) => win().setTimeout(resolve, ms))

  /** Brings the current match into view: its message mounted, its part unfolded, it scrolled to. */
  const show = async () => {
    const match = current.value
    const box = host.container()
    if (!match || !box) {
      repaint()
      return
    }
    const run = ++showing
    const at = host.messages().findIndex((m) => m.id === match.messageId)
    if (at < 0) return
    if (at < host.hidden()) host.mountFrom(Math.max(0, at - CONTEXT))
    await nextTick()
    host.revealPart(match.messageId, match.part)
    await nextTick()
    if (run !== showing) return

    // A message just mounted draws its markdown a moment later.
    let range = currentRange()
    const until = Date.now() + DRAW_WAIT_MS
    while (!range && Date.now() < until) {
      await wait(30)
      if (run !== showing) return
      range = currentRange()
    }
    const part = partsOf(match.messageId, match.part)[0]
    if (part) {
      const message = part.closest('[data-message-id]')
      if (message) openFolds(part, message)
    }
    repaint()

    const target = range ?? part
    if (!target) return
    const rect = target.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    const inView = rect.top >= boxRect.top + EDGE_PX && rect.bottom <= boxRect.bottom - EDGE_PX
    if (inView) return
    const holder =
      range?.startContainer.parentElement ?? (target instanceof HTMLElement ? target : null)
    if (!holder) return
    const inside = rect.top - holder.getBoundingClientRect().top
    host.holdInView(holder, box.clientHeight * VIEW_AT - inside)
  }

  /** Searches the conversation afresh; `follow` moves to the match nearest the reader. */
  const search = (follow: boolean) => {
    const was = current.value
    matches.value = findInMessages(host.messages(), query.value)
    if (!matches.value.length) {
      index.value = -1
    } else if (follow) {
      index.value = startingMatch(matches.value, host.messages(), topMessageId())
    } else {
      const kept = matches.value.findIndex((m) => sameMatch(was, m))
      index.value = kept >= 0 ? kept : Math.min(Math.max(index.value, 0), matches.value.length - 1)
    }
    if (follow) void show()
    else scheduleRepaint()
  }

  const flushTyping = () => {
    if (!typing) return
    win().clearTimeout(typing)
    typing = 0
    search(true)
  }

  const setQuery = (value: string) => {
    query.value = value
    if (typing) win().clearTimeout(typing)
    typing = win().setTimeout(() => {
      typing = 0
      search(true)
    }, SEARCH_DELAY_MS)
  }

  const step = (delta: 1 | -1) => {
    if (typing) {
      flushTyping()
      return
    }
    const n = matches.value.length
    if (!n) return
    index.value = (index.value + delta + n) % n
    void show()
  }

  const open = (focus = true) => {
    takesFocus.value = focus
    if (!isOpen.value) {
      isOpen.value = true
      void nextTick(observe)
    }
    if (focus) focusRequest.value++
  }

  /**
   * Opens on these words at the first match in one message — a result of the search across
   * chats, landing in the chat it was found in. `focus` false leaves the cursor out of the bar:
   * on a phone it would bring the keyboard up over the message just landed on.
   */
  const openAt = (words: string, messageId: string, focus = true) => {
    open(focus)
    query.value = words
    if (typing) win().clearTimeout(typing)
    typing = 0
    matches.value = findInMessages(host.messages(), words)
    const i = matches.value.findIndex((m) => m.messageId === messageId)
    index.value = i >= 0 ? i : startingMatch(matches.value, host.messages(), null)
    void show()
  }

  const close = () => {
    isOpen.value = false
    showing++
    if (typing) win().clearTimeout(typing)
    typing = 0
    observer?.disconnect()
    observer = null
    matches.value = []
    index.value = -1
    unpaint()
  }

  // The conversation changing under an open bar — a message arriving, a branch switched — is
  // counted again, keeping the match being shown where it still is. Nothing is scrolled to: the
  // reader is where they are.
  watch(
    () => host.messages(),
    () => {
      if (isOpen.value && query.value) search(false)
    }
  )

  // The box is a different element after a delegated run held the tab.
  watch(
    () => host.container(),
    () => {
      if (isOpen.value) observe()
    }
  )

  onBeforeUnmount(() => {
    const w = win()
    if (typing) w.clearTimeout(typing)
    if (repaintTimer) w.clearTimeout(repaintTimer)
    observer?.disconnect()
    unpaint()
  })

  return {
    isOpen,
    query,
    count,
    /** 1-based, for the counter; 0 when there is no match. */
    position: computed(() => index.value + 1),
    current,
    focusRequest,
    takesFocus,
    open,
    openAt,
    close,
    setQuery,
    next: () => step(1),
    previous: () => step(-1),
  }
}

export type ChatFind = ReturnType<typeof useChatFind>
