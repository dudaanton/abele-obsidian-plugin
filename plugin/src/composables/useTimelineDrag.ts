import { nextTick, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import dayjs from 'dayjs'
import { Notice } from 'obsidian'
import type { Task } from '@/entities/Task'
import { DATE_FORMAT } from '@/constants/dates'
import { timelinePinnedTop, timelineScrollOwner, type TimelineAnchor } from './useTimelineScroll'

const THRESHOLD = 8
const LONG_PRESS = 450
const EDGE = 48
const EDGE_DELAY = 300
const SCROLL_SPEED = 90 // CSS pixels per second, independent of display refresh rate.

interface DragRange {
  key: string
  day: string
  first: string
  last: string
}
interface Landing {
  key: string
  day: string
}

/** Gesture ownership starts only after intent, never on a click or an ordinary touch pan. */
export function useTimelineDrag(root: Ref<HTMLElement | null>, tasks: () => readonly Task[]) {
  const range = shallowRef<DragRange | null>(null)
  const landing = shallowRef<Landing | null>(null)
  const anchor = shallowRef<TimelineAnchor | null>(null)
  const targetDay = ref<string | null>(null)
  let dispose = () => {}
  let busy = false

  watch(
    root,
    (el) => {
      dispose()
      if (!el) return
      const doc = el.ownerDocument
      const win = doc.defaultView
      const owner = timelineScrollOwner(el)
      let candidate: {
        task: Task
        row: HTMLElement
        day: string
        x: number
        y: number
        id: number
        touch: boolean
        armed: boolean
      } | null = null
      let ghost: HTMLElement | null = null
      let original: HTMLElement | null = null
      let origin: DOMRect | null = null
      let previousLanding: Landing | null = null
      let x = 0,
        y = 0
      let pressTimer = 0
      let edgeTimer = 0
      let frame = 0
      let direction = 0
      let lastFrame = 0
      let blockClickUntil = 0

      const stopScroll = () => {
        win.clearTimeout(edgeTimer)
        win.cancelAnimationFrame(frame)
        edgeTimer = frame = direction = 0
      }
      const hitDay = () => {
        const hit = doc.elementFromPoint(x, y)?.closest<HTMLElement>('.abele-timeline__date-block')
        const day = hit && el.contains(hit) ? hit.dataset.abeleAnchor?.slice(5) : null
        targetDay.value =
          day && range.value && day >= range.value.first && day <= range.value.last ? day : null
      }
      const edgeDirection = () => {
        const box = owner.getBoundingClientRect()
        const top = timelinePinnedTop(owner)
        // Phone navigation floats over the scroll leaf; its top, not the obscured screen
        // bottom, is the edge a finger can use without pressing an app control.
        const bottom = doc.body.classList.contains('is-phone')
          ? Math.min(
              box.bottom,
              ...Array.from(doc.querySelectorAll('.mobile-navbar, .mobile-toolbar')).flatMap(
                (bar) => {
                  const rect = bar.getBoundingClientRect()
                  return rect.height &&
                    rect.width &&
                    rect.right > box.left &&
                    rect.left < box.right &&
                    rect.top > top &&
                    rect.top < box.bottom
                    ? [rect.top]
                    : []
                }
              )
            )
          : box.bottom
        if (x < box.left || x > box.right || y < top || y > bottom) return 0
        if (y < top + EDGE) return -1
        if (y > bottom - EDGE) return 1
        return 0
      }
      const scrollFrame = (at: number) => {
        if (!range.value || edgeDirection() !== direction) {
          stopScroll()
          return
        }
        owner.scrollTop += (direction * SCROLL_SPEED * Math.min(50, at - lastFrame)) / 1000
        lastFrame = at
        hitDay()
        frame = win.requestAnimationFrame(scrollFrame)
      }
      const updateEdge = () => {
        const next = edgeDirection()
        if (next === direction) return
        stopScroll()
        direction = next
        if (next)
          edgeTimer = win.setTimeout(() => {
            lastFrame = win.performance.now()
            frame = win.requestAnimationFrame(scrollFrame)
          }, EDGE_DELAY)
      }
      const clearVisual = () => {
        stopScroll()
        win.clearTimeout(pressTimer)
        ghost?.remove()
        ghost = null
        original?.classList.remove('abele-timeline__drag-source')
        original = null
        el.classList.remove('abele-timeline__dragging')
        targetDay.value = null
      }
      const end = async (cancel: boolean) => {
        win.clearTimeout(pressTimer)
        if (!range.value || !candidate) {
          candidate = null
          return
        }
        stopScroll()
        hitDay()
        const current = candidate
        const key = range.value.key
        const day = cancel ? null : targetDay.value
        const top = day
          ? ghost.getBoundingClientRect().top
          : current.row.getBoundingClientRect().top
        anchor.value = { key, day: day ?? current.day, top }
        blockClickUntil = Date.now() + 700
        candidate = null
        busy = true
        const previous = {
          date: current.task.date,
          due: current.task.due,
          dateTime: current.task.dateTime,
          dueTime: current.task.dueTime,
        }
        try {
          landing.value = day ? { key, day } : previousLanding
          if (day && day !== current.day) {
            // Shift the whole task, not only one occurrence of a date/due range. Persist with
            // the same API used by task creation/completion; no timeline-specific date writer.
            if (!current.task.content) await current.task.loadContent()
            if (current.task.taskNotFound) throw new Error('Task no longer exists')
            const shift = dayjs(day).diff(dayjs(current.day), 'day')
            for (const field of ['date', 'due', 'dateTime', 'dueTime'] as const)
              if (current.task[field]) current.task[field] = current.task[field].add(shift, 'day')
            await current.task.writeTaskToFile()
          }
        } catch {
          Object.assign(current.task, previous)
          landing.value = previousLanding
          anchor.value = {
            key,
            day: current.day,
            top: current.row.getBoundingClientRect().top,
          }
          new Notice('Could not move the task. Its date has not changed.')
        } finally {
          range.value = null
          clearVisual()
          await nextTick()
          // The scroll composable has captured this one-shot anchor before the layout patch.
          anchor.value = null
          busy = false
        }
      }
      const start = () => {
        if (!candidate) return
        const { task, row, day } = candidate
        origin = row.getBoundingClientRect()
        original = row
        ghost = row.cloneNode(true) as HTMLElement
        ghost.classList.add('abele-timeline__drag-card')
        ghost.removeAttribute('data-timeline-item')
        ghost.removeAttribute('data-abele-anchor')
        ghost.setAttribute('aria-hidden', 'true')
        ghost.inert = true
        for (const child of Array.from(ghost.querySelectorAll('[id]'))) child.removeAttribute('id')
        Object.assign(ghost.style, {
          left: `${origin.left}px`,
          top: `${origin.top}px`,
          width: `${origin.width}px`,
          margin: '0',
        })
        doc.body.append(ghost)
        row.classList.add('abele-timeline__drag-source')
        el.classList.add('abele-timeline__dragging')
        doc.getSelection()?.removeAllRanges()
        anchor.value = { key: `task:${task.id}`, day, top: origin.top }
        previousLanding = landing.value
        landing.value = null
        range.value = {
          key: `task:${task.id}`,
          day,
          first: dayjs(day).subtract(1, 'month').format(DATE_FORMAT),
          last: dayjs(day).add(1, 'month').format(DATE_FORMAT),
        }
        blockClickUntil = Date.now() + 700
        void nextTick(() => {
          anchor.value = null
          hitDay()
        })
      }
      const begin = (event: Event, px: number, py: number, id: number, touch: boolean) => {
        if (busy || candidate || range.value) return
        const target = event.target as HTMLElement
        // A checkbox, link or disclosure keeps its own click/tap action.
        if (target.closest('input, label, button, a, .abele-obsidian-icon')) return
        const row = target.closest<HTMLElement>('.abele-timeline__task[data-timeline-item]')
        if (!row || !el.contains(row)) return
        const task = tasks().find((t) => `task:${t.id}` === row.dataset.timelineItem)
        const day = row
          .closest<HTMLElement>('.abele-timeline__date-block')
          ?.dataset.abeleAnchor?.slice(5)
        if (!task || !day) return
        candidate = { task, row, day, x: px, y: py, id, touch, armed: !touch }
        if (touch)
          pressTimer = win.setTimeout(() => {
            if (candidate) candidate.armed = true
          }, LONG_PRESS)
      }
      const move = (event: Event, px: number, py: number) => {
        if (!candidate) return
        // WebKit decides native pan ownership on the first small movement, before our
        // threshold is crossed. An armed long press must reserve that first sample too.
        if (candidate.touch && candidate.armed) event.preventDefault()
        x = px
        y = py
        const distance = Math.hypot(x - candidate.x, y - candidate.y)
        if (!range.value) {
          if (distance < THRESHOLD) return
          if (!candidate.armed) {
            win.clearTimeout(pressTimer)
            candidate = null // This is a native pan; a later pause cannot turn it into a drag.
            return
          }
          start()
          // Expansion is anchored at the original location; the first threshold-crossing
          // sample does not displace the floating card either.
        } else if (ghost && origin) {
          ghost.style.left = `${origin.left + x - candidate.x}px`
          ghost.style.top = `${origin.top + y - candidate.y}px`
        }
        event.preventDefault()
        hitDay()
        updateEdge()
      }
      const pointerDown = (event: PointerEvent) => {
        if (event.pointerType === 'touch' || event.button !== 0 || event.isPrimary === false) return
        begin(event, event.clientX, event.clientY, event.pointerId, false)
      }
      const pointerMove = (event: PointerEvent) => {
        if (candidate && !candidate.touch && candidate.id === event.pointerId)
          move(event, event.clientX, event.clientY)
      }
      const pointerEnd = (event: PointerEvent) => {
        if (candidate && !candidate.touch && candidate.id === event.pointerId) {
          x = event.clientX
          y = event.clientY
          void end(event.type === 'pointercancel')
        }
      }
      const touchStart = (event: TouchEvent) => {
        if (event.touches.length !== 1) {
          void end(true)
          return
        }
        const touch = event.touches[0]
        begin(event, touch.clientX, touch.clientY, touch.identifier, true)
      }
      const touchMove = (event: TouchEvent) => {
        if (!candidate?.touch) return
        if (event.touches.length !== 1) {
          void end(true)
          return
        }
        const touch = Array.from(event.touches).find((t) => t.identifier === candidate.id)
        if (touch) move(event, touch.clientX, touch.clientY)
      }
      const touchEnd = (event: TouchEvent) => {
        if (!candidate?.touch) return
        if (range.value) event.preventDefault()
        const touch = Array.from(event.changedTouches).find((t) => t.identifier === candidate.id)
        if (touch) {
          x = touch.clientX
          y = touch.clientY
        }
        void end(event.type === 'touchcancel')
      }
      const keydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && candidate) {
          event.preventDefault()
          void end(true)
        }
      }
      const suppress = (event: Event) => {
        if (
          range.value ||
          Date.now() < blockClickUntil ||
          (event.type === 'contextmenu' && candidate?.touch && candidate.armed)
        ) {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      }
      const blur = () => {
        void end(true)
      }
      el.addEventListener('pointerdown', pointerDown)
      doc.addEventListener('pointermove', pointerMove)
      doc.addEventListener('pointerup', pointerEnd)
      doc.addEventListener('pointercancel', pointerEnd)
      el.addEventListener('touchstart', touchStart, { passive: true })
      doc.addEventListener('touchmove', touchMove, { passive: false })
      doc.addEventListener('touchend', touchEnd, { passive: false })
      doc.addEventListener('touchcancel', touchEnd)
      doc.addEventListener('keydown', keydown)
      el.addEventListener('click', suppress, true)
      el.addEventListener('contextmenu', suppress, true)
      el.addEventListener('dragstart', suppress)
      win.addEventListener('blur', blur)
      dispose = () => {
        clearVisual()
        candidate = null
        range.value = anchor.value = null
        el.removeEventListener('pointerdown', pointerDown)
        doc.removeEventListener('pointermove', pointerMove)
        doc.removeEventListener('pointerup', pointerEnd)
        doc.removeEventListener('pointercancel', pointerEnd)
        el.removeEventListener('touchstart', touchStart)
        doc.removeEventListener('touchmove', touchMove)
        doc.removeEventListener('touchend', touchEnd)
        doc.removeEventListener('touchcancel', touchEnd)
        doc.removeEventListener('keydown', keydown)
        el.removeEventListener('click', suppress, true)
        el.removeEventListener('contextmenu', suppress, true)
        el.removeEventListener('dragstart', suppress)
        win.removeEventListener('blur', blur)
      }
    },
    { flush: 'post' }
  )
  onScopeDispose(() => dispose())
  return { range, landing, anchor, targetDay }
}
