import { expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'
import PictureSession from '@/components/drawing/PictureSession.vue'
import PictureEditor from '@/components/drawing/PictureEditor.vue'
import { emptyDrawingModel } from '@/drawing/model'
import type { DrawingSession } from '@/drawing/DrawingSession'
import { wholePicture } from '@/drawing/crop'

it.each([false, true])('renders phone tools with cropping=%s', async (cropping) => {
  const wrapper = mount(PictureEditor, {
    props: { model: emptyDrawingModel(), crop: wholePicture(), cropping, phone: true },
  })
  expect(wrapper.findAll('.abele-picture-editor__tools .abele-picture-editor__tool')).toHaveLength(
    7
  )
  await wrapper.get('.abele-picture-editor__tool_crop').trigger('click')
  expect(wrapper.emitted('crop')).toHaveLength(1)
  await wrapper.get('.abele-picture-editor__tool_pen').trigger('click')
  expect(wrapper.emitted('tool')).toEqual([['pen']])
  expect(wrapper.find('.abele-picture-editor__stage').exists()).toBe(true)
  wrapper.unmount()
})

it('clips picture and ink after crop and reveals the source on re-entry', async () => {
  const state = reactive({
    crop: { ...wholePicture(), rect: { x: 0.25, y: 0, w: 0.5, h: 1 } },
    cropping: true,
    dirty: true,
    status: null,
    width: 800,
    height: 600,
    camera: { x: 0, y: 0, zoom: 1 },
  })
  const fit = vi.fn()
  const session = {
    surface: { renderer: { paint: vi.fn() }, paintLive: vi.fn() },
    items: { items: [] },
    camera: state.camera,
    stop: vi.fn(),
    start: vi.fn(),
  } as unknown as DrawingSession
  const wrapper = mount(PictureSession, {
    props: {
      model: emptyDrawingModel(),
      state,
      actions: {
        ready: () => session,
        fit,
        cancel: vi.fn(),
        save: vi.fn(),
        shape: vi.fn(),
        thickness: vi.fn(),
        zoom: vi.fn(),
        commit: vi.fn(),
        undo: vi.fn(),
        redo: vi.fn(),
      },
    },
  })
  const stage = wrapper.get('.abele-picture-session').element as HTMLElement
  expect(stage.style.clipPath).toBe('')
  state.cropping = false
  await nextTick()
  expect(stage.style.clipPath).toBe('polygon(200px 0px, 600px 0px, 600px 600px, 200px 600px)')
  expect(fit).toHaveBeenCalledTimes(1)
  state.cropping = true
  await nextTick()
  expect(stage.style.clipPath).toBe('')
  expect(fit).toHaveBeenCalledTimes(2)
  expect(state.crop.rect).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 })
  wrapper.unmount()
})

it.each([0, 1, 2, 3] as const)(
  'keeps pointer coordinates over the cropped view after turn %s',
  (turns) => {
    const state = reactive({
      crop: { ...wholePicture(), turns, flipped: true, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
      cropping: false,
      dirty: true,
      status: null,
      width: 800,
      height: 600,
      camera: { x: 100, y: 50, zoom: 2 },
    })
    const session = {
      surface: { renderer: { paint: vi.fn() }, paintLive: vi.fn() },
      items: { items: [] },
      camera: state.camera,
    } as unknown as DrawingSession
    const wrapper = mount(PictureSession, {
      props: {
        model: emptyDrawingModel(),
        state,
        actions: {
          ready: () => session,
          fit: vi.fn(),
          cancel: vi.fn(),
          save: vi.fn(),
          shape: vi.fn(),
          thickness: vi.fn(),
          zoom: vi.fn(),
          commit: vi.fn(),
          undo: vi.fn(),
          redo: vi.fn(),
        },
      },
    })
    // Source (450, 325), transformed about the image centre, then through the camera.
    const angle = (-turns * Math.PI) / 2
    const dx = -(50 * Math.cos(angle) - 25 * Math.sin(angle))
    const dy = 50 * Math.sin(angle) + 25 * Math.cos(angle)
    const mapped = session.surface.mapClientPoint!({ clientX: 600 + dx * 2, clientY: 500 + dy * 2 })
    expect(mapped[0]).toBeCloseTo(700)
    expect(mapped[1]).toBeCloseTo(550)
    expect(wrapper.get('.abele-picture-session').attributes('style')).toContain('polygon(')
    wrapper.unmount()
  }
)
