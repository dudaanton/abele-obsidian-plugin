import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import CropFrame from '@/components/drawing/CropFrame.vue'
import { zoomAt, type Camera } from '@/drawing/camera'

afterEach(() => vi.restoreAllMocks())

it('keeps resizing when pointer capture is transferred to the editor surface', () => {
  const stage = document.createElement('div')
  document.body.append(stage)
  const wrapper = mount(CropFrame, {
    attachTo: stage,
    props: { rect: { x: 0, y: 0, w: 1, h: 1 }, ratio: null, picture: 1, surface: stage },
  })
  const handle = wrapper.get('.abele-crop-frame__handle_se').element
  vi.spyOn(handle.parentElement!.parentElement!, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 400,
  } as DOMRect)
  const pointer = (target: Element, type: string, pointerId: number, clientX: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'touch',
        clientX,
        clientY: clientX,
        button: 0,
      })
    )
  try {
    pointer(handle, 'pointerdown', 1, 400)
    // Captured events target the capture owner, rather than the original handle.
    pointer(stage, 'pointermove', 2, 200)
    expect(wrapper.emitted('update:rect')).toBeUndefined()
    pointer(stage, 'pointermove', 1, 200)
    expect(wrapper.emitted('update:rect')?.[0]?.[0]).toMatchObject({ w: 0.5, h: 0.5 })
    pointer(stage, 'pointerup', 1, 200)
    expect(wrapper.emitted('commit')).toHaveLength(1)
    pointer(stage, 'pointermove', 1, 100)
    expect(wrapper.emitted('update:rect')).toHaveLength(1)
  } finally {
    wrapper.unmount()
    stage.remove()
  }
})

it.each([
  ['frame', 'background'],
  ['background', 'frame'],
  ['background', 'background'],
  ['frame', 'frame'],
])('zooms out from %s / %s and back below fit-to-view', (first, second) => {
  const stage = document.createElement('div')
  const background = stage.appendChild(document.createElement('div'))
  document.body.append(stage)
  let camera: Camera = { x: 0, y: 0, zoom: 0.22 }
  const wrapper = mount(CropFrame, {
    attachTo: stage,
    props: {
      rect: { x: 0, y: 0, w: 1, h: 1 },
      ratio: null,
      picture: 8,
      surface: stage,
      onNavigate: (from, _to, factor) => {
        camera = zoomAt(camera, from.clientX, from.clientY, factor, 0.001)
      },
    },
  })
  const frame = wrapper.get('.abele-crop-frame__frame').element
  const canvasMove = vi.fn()
  background.addEventListener('pointermove', canvasMove)
  vi.spyOn(frame.parentElement!, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 50,
  } as DOMRect)
  const pointer = (target: Element, type: string, pointerId: number, clientX: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'touch',
        clientX,
        clientY: 100,
        button: 0,
      })
    )
  const pinch = (factor: number) => {
    const a = first === 'frame' ? frame : background
    const b = second === 'frame' ? frame : background
    pointer(a, 'pointerdown', 1, 100)
    pointer(b, 'pointerdown', 2, 200)
    pointer(a, 'pointermove', 1, 150 - factor * 50)
    pointer(b, 'pointermove', 2, 150 + factor * 50)
    pointer(a, 'pointerup', 1, 150 - factor * 50)
    pointer(b, 'pointerup', 2, 150 + factor * 50)
  }
  try {
    pinch(0.7)
    expect(camera.zoom).toBeCloseTo(0.154)
    pinch(0.5)
    expect(camera.zoom).toBeCloseTo(0.077)
    expect(camera.zoom).toBeLessThan(0.08)
    expect(wrapper.emitted('update:rect')).toBeUndefined()
    expect(canvasMove).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
    stage.remove()
  }
})
