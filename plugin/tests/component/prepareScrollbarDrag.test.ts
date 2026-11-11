import { expect, it } from 'vitest'
import { prepareScrollbarDrag, scrollbarDragPoint } from '../e2e/helpers/scrollbarDragPoint'

it('reveals the overlay with native wheel input and then reads fresh thumb geometry', async () => {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ left: 100, right: 520, top: 50, bottom: 650 }) as DOMRect
  Object.defineProperties(el, {
    clientHeight: { value: 600 },
    scrollHeight: { value: 3000 },
    clientWidth: { value: 420 },
    offsetWidth: { value: 420 },
  })
  el.scrollTop = 2400
  const events: unknown[] = []
  const point = await prepareScrollbarDrag(
    el,
    async (method, params) => {
      events.push({ method, ...params })
      if (params.type === 'mouseWheel') {
        el.scrollTop += Number(params.deltaY)
        // A render-window rebase can change the range while native input settles.
        if (Number(params.deltaY) > 0) el.scrollTop -= 32
      }
    },
    async (ms) => {
      events.push({ wait: ms })
    },
    scrollbarDragPoint
  )
  expect(events).toEqual([
    {
      method: 'Input.dispatchMouseEvent',
      type: 'mouseWheel',
      x: 514,
      y: 590,
      deltaX: 0,
      deltaY: -32,
    },
    { wait: 100 },
    {
      method: 'Input.dispatchMouseEvent',
      type: 'mouseWheel',
      x: 514,
      y: 590,
      deltaX: 0,
      deltaY: 32,
    },
    { wait: 100 },
    { method: 'Input.dispatchMouseEvent', type: 'mouseMoved', x: 514, y: 583.6, buttons: 0 },
    { wait: 100 },
  ])
  expect(point).toEqual({ x: 514, y: 583.6 })
})

it.each([0, 10, 2400])('leaves no net reveal scroll with %s pixels of overflow', async (range) => {
  const el = document.createElement('div')
  Object.defineProperties(el, {
    clientHeight: { value: 600 },
    scrollHeight: { value: 600 + range },
  })
  el.scrollTop = range
  await prepareScrollbarDrag(
    el,
    async (_method, params) => {
      if (params.type === 'mouseWheel')
        el.scrollTop = Math.max(0, Math.min(range, el.scrollTop + Number(params.deltaY)))
    },
    async () => {},
    scrollbarDragPoint
  )
  expect(el.scrollTop).toBe(range)
})
