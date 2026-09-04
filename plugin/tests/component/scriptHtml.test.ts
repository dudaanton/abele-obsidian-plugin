/**
 * Where the catalogue ends and the script's own markup begins.
 *
 * Three things must hold: the markup appears, a delegated handler fires for the element it
 * names and not for others, and a kit node lands inside the element its selector points at —
 * and all three again after the script assigns new markup.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ScriptViewComponent from '@/components/ScriptView.vue'
import KitButton from '@/components/obsidian/Button.vue'
import { View, type ViewHost } from '@/scripting/view/View'
import { Html, Button, Text } from '@/scripting/view/components'
import type { ScriptViewModel } from '@/views/ScriptView'

const host: ViewHost = {
  async open(v) {
    v.leafId = 'L'
  },
  close() {},
}
const live = (view: View): ScriptViewModel => ({
  id: 'leaf-1',
  view,
  status: { kind: 'live' },
  saved: null,
  runAgain: vi.fn(),
})
const make = () => new View({ title: 'T' }, host, { script: 'Demo', params: {} })

describe('Html', () => {
  it('shows the markup and mounts kit nodes into it', async () => {
    const v = make()
    v.body = [
      new Html({
        html: '<article class="post"><h3>Title</h3><div class="body"></div></article>',
        children: { '.body': new Button({ text: 'Open' }) },
      }),
    ]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await flushPromises()
    expect(w.find('article.post h3').text()).toBe('Title')
    // Raw markup has no Vue parent for a `DOMWrapper.findComponent` to walk from, so the
    // check is the other way round: the kit component exists and its element is in `.body`.
    const button = w.findComponent(KitButton)
    expect(button.props('text')).toBe('Open')
    expect(w.find('.body').element.contains(button.element)).toBe(true)
  })

  it('delegates events by selector and hands over the matched element', async () => {
    const v = make()
    const open = vi.fn()
    const other = vi.fn()
    v.body = [
      new Html({
        html: '<div><button data-open>Open</button><button data-other>Other</button></div>',
        on: { 'click [data-open]': open, 'click [data-other]': other },
      }),
    ]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await w.find('[data-open]').trigger('click')
    await flushPromises()
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][1]).toBe(w.find('[data-open]').element)
    expect(other).not.toHaveBeenCalled()
  })

  it('fires mount with the root, again after the markup changes, and re-mounts slots', async () => {
    const v = make()
    const mounted = vi.fn()
    const h = new Html({
      html: '<p class="a"></p>',
      children: { '.a': new Text('inside') },
      onMount: mounted,
    })
    v.body = [h]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await flushPromises()
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(mounted.mock.calls[0][0]).toBe(w.find('.abele-script-html').element)
    expect(w.find('.a').text()).toBe('inside')
    h.html = '<section class="a"></section><p class="b"></p>'
    await nextTick()
    await flushPromises()
    expect(mounted).toHaveBeenCalledTimes(2)
    expect(w.find('section.a').text()).toBe('inside')
  })

  it('reports a slot selector that matches nothing, once', async () => {
    const v = make()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    v.body = [new Html({ html: '<p></p>', children: { '.missing': new Text('x') } })]
    mount(ScriptViewComponent, { props: { model: live(v) } })
    await flushPromises()
    expect(v.errors).toEqual(['Html: nothing matches ".missing"'])
  })

  it('fires a handler bound to the root, with no selector, for a click inside', async () => {
    const v = make()
    const pressed = vi.fn()
    const h = new Html({ html: '<p class="x">x</p>' })
    h.on('click', pressed)
    v.body = [h]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await flushPromises()
    await w.find('.x').trigger('click')
    await flushPromises()
    expect(pressed).toHaveBeenCalledTimes(1)
    expect(pressed.mock.calls[0][0]).toBeInstanceOf(Event)
  })

  it('takes the same root handler from the constructor, where the spec names no selector', async () => {
    const v = make()
    const pressed = vi.fn()
    v.body = [new Html({ html: '<p class="x">x</p>', on: { click: pressed } })]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await flushPromises()
    await w.find('.x').trigger('click')
    await flushPromises()
    expect(pressed).toHaveBeenCalledTimes(1)
  })

  it('a handler added after mount still fires', async () => {
    const v = make()
    const h = new Html({ html: '<button class="x">x</button>' })
    v.body = [h]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    const late = vi.fn()
    h.on('click', late, '.x')
    await nextTick()
    await w.find('.x').trigger('click')
    await flushPromises()
    expect(late).toHaveBeenCalled()
  })
})
