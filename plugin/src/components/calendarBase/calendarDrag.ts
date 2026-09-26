/**
 * Dragging a note to another day, or another hour, on the calendar view of a base.
 *
 * Pointer events, so a mouse and a finger go through the same code, with one difference that
 * keeps a tap a tap: a mouse starts dragging once it has moved a few pixels with the button
 * down, a finger only after it has rested on the note for a moment. A finger that moves before
 * then is scrolling, and is left to scroll.
 *
 * Where a note can land is said by the drawing itself: an element with `data-drop-day` takes it
 * on that day, and one that also has `data-drop-hours` is a day's 24 hours top to bottom, so
 * the height the note is let go at is its new time, to the quarter hour. The note follows the
 * pointer as a small label; over the hours a box shows where and how long it will be.
 */
import { inject, type InjectionKey } from 'vue'
import { MINUTES_IN_DAY, clock, isTimed, type PlacedItem } from '@/bases/calendarLayout'

export interface CalendarDrop {
  day: string
  /** Minutes after midnight when dropped on the hours; null on a day. */
  minute: number | null
}

export interface CalendarDrag {
  /** Bound to a chip's `pointerdown`: the start of a drag, or of a plain press. */
  press(placed: PlacedItem, event: PointerEvent): void
}

export const CALENDAR_DRAG: InjectionKey<CalendarDrag> = Symbol('abele-calendar-drag')

export const useCalendarDrag = (): CalendarDrag | null => inject(CALENDAR_DRAG, null)

/** How far a mouse moves with the button down before it is a drag, in pixels. */
const MOUSE_SLOP = 5
/** How far a finger may wander while it is held before it counts as scrolling. */
const TOUCH_SLOP = 10
/** How long a finger rests on a note before it picks it up. */
export const HOLD_MS = 400
/** The grid a note dropped on the hours snaps to. */
const SNAP = 15
/** How near the edge of the hours the pointer scrolls them, and how fast. */
const EDGE = 40
const EDGE_SPEED = 12

const TARGET_CLASS = 'abele-calendar-drop-target'

export interface DragOptions {
  /** False when nothing can be written — a date that is a formula. */
  enabled(): boolean
  drop(placed: PlacedItem, to: CalendarDrop): void
}

export function createCalendarDrag(options: DragOptions): CalendarDrag {
  const press = (placed: PlacedItem, down: PointerEvent) => {
    if (!options.enabled() || placed.item.kind !== 'note' || down.button !== 0) return
    const chip = down.currentTarget as HTMLElement | null
    if (!chip) return
    const doc = chip.ownerDocument
    const win = doc.defaultView ?? window
    const touch = down.pointerType !== 'mouse'
    const startX = down.clientX
    const startY = down.clientY
    const box = chip.getBoundingClientRect()
    // Where in the note it was taken, so a block dropped on the hours starts where its top is.
    const grabY = isTimed(placed.item) && chip.closest('[data-drop-hours]') ? startY - box.top : 0
    const duration =
      placed.item.startMinute !== null && placed.item.endMinute !== null && isTimed(placed.item)
        ? Math.max(SNAP, placed.item.endMinute - placed.item.startMinute)
        : 60

    let dragging = false
    let holdTimer: number | null = null
    let ghost: HTMLElement | null = null
    let marker: HTMLElement | null = null
    let target: HTMLElement | null = null
    let over: CalendarDrop | null = null
    let lastX = startX
    let lastY = startY
    let frame = 0

    const setTarget = (el: HTMLElement | null) => {
      if (target === el) return
      target?.classList.remove(TARGET_CLASS)
      target = el
      target?.classList.add(TARGET_CLASS)
    }

    const locate = () => {
      const under = doc.elementFromPoint(lastX, lastY) as HTMLElement | null
      const el = under?.closest<HTMLElement>('[data-drop-day]') ?? null
      setTarget(el)
      if (!el) {
        over = null
      } else if (el.hasAttribute('data-drop-hours')) {
        const rect = el.getBoundingClientRect()
        const raw = ((lastY - grabY - rect.top) / rect.height) * MINUTES_IN_DAY
        const minute = Math.max(0, Math.min(MINUTES_IN_DAY - SNAP, Math.round(raw / SNAP) * SNAP))
        over = { day: el.dataset.dropDay, minute }
        showMarker(rect, minute)
      } else {
        over = { day: el.dataset.dropDay, minute: null }
      }
      if (!over || over.minute === null) marker?.remove()
      if (ghost) {
        ghost.style.left = `${lastX + 12}px`
        ghost.style.top = `${lastY + 12}px`
        const time = over?.minute != null ? `${clock(over.minute)} ` : ''
        ghost.textContent = time + placed.item.title
      }
    }

    const showMarker = (rect: DOMRect, minute: number) => {
      if (!marker) {
        marker = doc.body.createDiv({ cls: 'abele-calendar-drop-marker' })
      }
      if (!marker.isConnected) doc.body.appendChild(marker)
      const height = (Math.min(duration, MINUTES_IN_DAY - minute) / MINUTES_IN_DAY) * rect.height
      marker.style.left = `${rect.left}px`
      marker.style.width = `${rect.width}px`
      marker.style.top = `${rect.top + (minute / MINUTES_IN_DAY) * rect.height}px`
      marker.style.height = `${height}px`
      marker.textContent = clock(minute)
    }

    /** Scrolls the hours while the pointer rests near their top or bottom edge. */
    const edgeScroll = () => {
      frame = win.requestAnimationFrame(edgeScroll)
      const under = doc.elementFromPoint(lastX, lastY) as HTMLElement | null
      const hours = under?.closest<HTMLElement>('.abele-calendar-week__hours')
      if (!hours) return
      const rect = hours.getBoundingClientRect()
      const by = lastY < rect.top + EDGE ? -EDGE_SPEED : lastY > rect.bottom - EDGE ? EDGE_SPEED : 0
      if (!by) return
      const before = hours.scrollTop
      hours.scrollTop += by
      if (hours.scrollTop !== before) locate()
    }

    const begin = () => {
      dragging = true
      holdTimer = null
      ghost = doc.body.createDiv({ cls: 'abele-calendar-drag-ghost' })
      doc.body.classList.add('abele-calendar-dragging')
      chip.classList.add('abele-calendar-chip_lifted')
      navigator.vibrate?.(10)
      locate()
      frame = win.requestAnimationFrame(edgeScroll)
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId) return
      lastX = e.clientX
      lastY = e.clientY
      if (dragging) {
        e.preventDefault()
        locate()
        return
      }
      const moved = Math.hypot(lastX - startX, lastY - startY)
      if (touch) {
        if (moved > TOUCH_SLOP) finish(false)
      } else if (moved > MOUSE_SLOP) {
        begin()
      }
    }

    // A held finger must not scroll the page under the note it carries.
    const onTouchMove = (e: TouchEvent) => {
      if (dragging) e.preventDefault()
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId) return
      lastX = e.clientX
      lastY = e.clientY
      if (dragging) locate()
      finish(dragging)
    }

    const onCancel = (e: PointerEvent) => {
      if (e.pointerId === down.pointerId) finish(false)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragging) return
      e.preventDefault()
      e.stopPropagation()
      finish(false)
    }

    // A long press on a phone would otherwise also open the system's menu for the text.
    const onContextMenu = (e: Event) => {
      if (touch) e.preventDefault()
    }

    /**
     * The click that follows letting go of a drag is not a press on what is under it. The
     * browser sends it straight after the pointer's release, in the same turn, so the guard
     * goes as soon as that turn is over and cannot eat a later, real click.
     */
    const swallowClick = () => {
      const eat = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()
        win.removeEventListener('click', eat, true)
      }
      win.addEventListener('click', eat, true)
      win.setTimeout(() => win.removeEventListener('click', eat, true), 0)
    }

    const finish = (dropped: boolean) => {
      if (holdTimer) win.clearTimeout(holdTimer)
      holdTimer = null
      win.removeEventListener('pointermove', onMove, true)
      win.removeEventListener('pointerup', onUp, true)
      win.removeEventListener('pointercancel', onCancel, true)
      win.removeEventListener('touchmove', onTouchMove, true)
      win.removeEventListener('keydown', onKey, true)
      win.removeEventListener('contextmenu', onContextMenu, true)
      if (frame) win.cancelAnimationFrame(frame)
      if (!dragging) return
      dragging = false
      swallowClick()
      ghost?.remove()
      marker?.remove()
      setTarget(null)
      doc.body.classList.remove('abele-calendar-dragging')
      chip.classList.remove('abele-calendar-chip_lifted')
      // Let go where it was taken — a long press that never moved — is not a move: the snap to
      // the quarter hour would otherwise shift a note at 09:05 to 09:00.
      const away = Math.hypot(lastX - startX, lastY - startY) > (touch ? TOUCH_SLOP : MOUSE_SLOP)
      if (dropped && over && away) options.drop(placed, over)
    }

    win.addEventListener('pointermove', onMove, true)
    win.addEventListener('pointerup', onUp, true)
    win.addEventListener('pointercancel', onCancel, true)
    win.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    win.addEventListener('keydown', onKey, true)
    win.addEventListener('contextmenu', onContextMenu, true)
    if (touch) holdTimer = win.setTimeout(begin, HOLD_MS)
  }

  return { press }
}
