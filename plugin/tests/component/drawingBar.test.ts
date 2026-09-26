/**
 * The row over a drawing (`DrawingBar.vue`): the button that turns drawing on and off, first and
 * in one place either way; the tools, colours, undo and redo while drawing; the zoom always.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DrawingBar from '@/components/drawing/DrawingBar.vue'
import { emptyDrawingModel, type DrawingModel } from '@/drawing/model'

const model = (over: Partial<DrawingModel> = {}): DrawingModel => ({
  ...emptyDrawingModel(),
  ...over,
})

describe('the drawing bar', () => {
  it('keeps Obsidian’s swipes off itself and says what it is', () => {
    const bar = mount(DrawingBar, { props: { model: model() } })
    expect(bar.attributes('data-ignore-swipe')).toBe('true')
    expect(bar.attributes('role')).toBe('toolbar')
  })

  it('has the way in and the way out first, in one place', async () => {
    const off = mount(DrawingBar, { props: { model: model() } })
    expect(off.find('.abele-obsidian-icon').classes()).toContain('abele-drawing-bar__mode')
    expect(off.find('.abele-drawing-bar__tool').exists()).toBe(false)
    await off.find('.abele-drawing-bar__mode').trigger('click')
    expect(off.emitted('toggle')).toHaveLength(1)
    const on = mount(DrawingBar, { props: { model: model({ on: true }) } })
    expect(on.find('.abele-obsidian-icon').classes()).toContain('abele-drawing-bar__mode')
    expect(on.findAll('.abele-drawing-bar__tool')).toHaveLength(3)
  })

  it('shows the tool in hand pressed and its colours, and says which tool was picked', async () => {
    const bar = mount(DrawingBar, { props: { model: model({ on: true, tool: 'marker' }) } })
    expect(bar.find('.abele-drawing-bar__tool_marker').attributes('aria-pressed')).toBe('true')
    // The marker's colours: yellow first, and yellow is the one in hand.
    const swatches = bar.findAll('.abele-drawing-bar__swatch')
    expect(swatches).toHaveLength(4)
    expect(swatches[0].attributes('aria-pressed')).toBe('true')
    await bar.find('.abele-drawing-bar__tool_eraser').trigger('click')
    expect(bar.emitted('tool')?.[0]).toEqual(['eraser'])
    await swatches[2].trigger('click')
    expect(bar.emitted('color')?.[0]).toEqual(['blue'])
  })

  it('offers drawing with a finger on a touch screen only', () => {
    expect(
      mount(DrawingBar, { props: { model: model({ on: true }) } })
        .find('.abele-drawing-bar__finger')
        .exists()
    ).toBe(false)
    expect(
      mount(DrawingBar, { props: { model: model({ on: true, touch: true }) } })
        .find('.abele-drawing-bar__finger')
        .exists()
    ).toBe(true)
  })

  it('greys out undo and redo with nothing to take back, and shows the zoom', async () => {
    const bar = mount(DrawingBar, { props: { model: model({ on: true, zoom: 1.5 }) } })
    expect(bar.find('.abele-drawing-bar__undo').classes()).toContain('abele-obsidian-icon_disabled')
    await bar.find('.abele-drawing-bar__undo').trigger('click')
    expect(bar.emitted('undo')).toBeUndefined()
    expect(bar.find('.abele-drawing-bar__zoom').text()).toContain('150%')
    const can = mount(DrawingBar, { props: { model: model({ on: true, canUndo: true }) } })
    await can.find('.abele-drawing-bar__undo').trigger('click')
    expect(can.emitted('undo')).toHaveLength(1)
  })
})
