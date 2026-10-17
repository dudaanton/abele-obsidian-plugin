import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AgentView from '@/components/chat/AgentView.vue'
import { ASK_EVENT, cleanViewHtml } from '@/views/agentView'

const { openNote } = vi.hoisted(() => ({ openNote: vi.fn() }))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: { workspace: { openLinkText: openNote } } }) },
}))

afterEach(() => {
  vi.restoreAllMocks()
  document.body.removeAttribute('style')
})

function setFrameHtml(doc: Document, html: string) {
  const parsed = new DOMParser().parseFromString(cleanViewHtml(html), 'text/html')
  doc.body.replaceChildren(...Array.from(parsed.body.childNodes))
}

describe('agent view frame', () => {
  it('routes touch-only and pointer taps once, captures clicks, and supports Enter', async () => {
    const view = mount(AgentView, { props: { html: '<p>View</p>' }, attachTo: document.body })
    await nextTick()
    const iframe = view.get('iframe')
    const doc = (iframe.element as HTMLIFrameElement).contentDocument!
    setFrameHtml(doc, '<a href="abele:ask?text=Compare"><span>Compare</span></a>')
    await iframe.trigger('load')
    const target = doc.querySelector('span')!
    const ask = vi.fn()
    view.element.addEventListener(ASK_EVENT, ask)
    const touch = (type: string, x = 10, y = 10) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, {
        touches: { value: type === 'touchend' ? [] : [{ identifier: 1, clientX: x, clientY: y }] },
        changedTouches: { value: [{ identifier: 1, clientX: x, clientY: y }] },
      })
      target.dispatchEvent(event)
    }
    touch('touchstart')
    touch('touchend')
    expect(ask).toHaveBeenCalledTimes(1)
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(ask).toHaveBeenCalledTimes(1)
    const pointer = (type: string, y = 10) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: 'touch',
          pointerId: 1,
          isPrimary: true,
          clientX: 10,
          clientY: y,
        })
      )
    pointer('pointerdown')
    touch('touchstart')
    pointer('pointerup')
    touch('touchend')
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(ask).toHaveBeenCalledTimes(2)
    // A swipe and a canceled contact must not activate a link.
    pointer('pointerdown')
    pointer('pointermove', 60)
    pointer('pointerup', 10)
    touch('touchstart')
    touch('touchmove', 10, 60)
    touch('touchend')
    expect(ask).toHaveBeenCalledTimes(2)
    pointer('pointerdown')
    pointer('pointercancel')
    pointer('pointerup')
    expect(ask).toHaveBeenCalledTimes(2)
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    )
    expect(ask).toHaveBeenCalledTimes(3)
    // Capture still receives a click stopped below the document's bubble phase.
    target.addEventListener('click', (event) => event.stopPropagation())
    target.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'mouse',
        button: 0,
        isPrimary: true,
      })
    )
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(ask).toHaveBeenCalledTimes(4)
    view.unmount()
    touch('touchstart')
    touch('touchend')
    expect(ask).toHaveBeenCalledTimes(4)
  })
  it('measures content rather than retaining the previous iframe viewport height', async () => {
    const view = mount(AgentView, { props: { html: '<p>View</p>' }, attachTo: document.body })
    await nextTick()
    const iframe = view.get('iframe')
    const doc = (iframe.element as HTMLIFrameElement).contentDocument!
    let resize = () => {}
    const observe = vi.fn()
    const disconnect = vi.fn()
    doc.defaultView!.ResizeObserver = class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this)
      }
      observe = observe
      disconnect = disconnect
      unobserve() {}
    }
    Object.defineProperty(doc.documentElement, 'scrollHeight', { configurable: true, value: 700 })
    Object.defineProperty(doc.body, 'scrollHeight', { configurable: true, value: 240 })
    await iframe.trigger('load')
    expect((iframe.element as HTMLIFrameElement).style.height).toBe('240px')
    expect((iframe.element as HTMLIFrameElement).style.maxHeight).toBe('32em')
    expect(observe).toHaveBeenCalledWith(doc.body)
    Object.defineProperty(doc.body, 'scrollHeight', { configurable: true, value: 120 })
    resize()
    await nextTick()
    expect((iframe.element as HTMLIFrameElement).style.height).toBe('120px')
    view.unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
  it('forwards questions from the enlarged view to the original chat', async () => {
    const view = mount(AgentView, {
      props: { html: '<p>View</p>' },
      global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
    })
    const ask = vi.fn()
    view.element.addEventListener(ASK_EVENT, ask)
    await view
      .findAllComponents({ name: 'Icon' })
      .find((icon) => icon.props('icon') === 'maximize-2')!
      .trigger('click')
    const enlarged = view.findAllComponents(AgentView).find((child) => child.props('inWindow'))!
    enlarged.vm.$emit('ask', 'Compare these')
    expect(ask).toHaveBeenCalledTimes(1)
    expect((ask.mock.calls[0][0] as CustomEvent).detail.text).toBe('Compare these')
    view.unmount()
  })
  it('routes only allowed clicks, with an unsent question bubbling to the chat', async () => {
    const view = mount(AgentView, { props: { html: '<p>View</p>' }, attachTo: document.body })
    const iframe = view.get('iframe')
    await nextTick()
    const frame = iframe.element as HTMLIFrameElement
    expect(iframe.attributes('sandbox')).toBe('allow-same-origin')
    const doc = frame.contentDocument!
    setFrameHtml(
      doc,
      '<a href="https://example.test">web</a><a href="abele:note?path=Sample.md">note</a><a href="abele:ask?text=More%20please">ask</a><a href="javascript:alert(1)">bad</a>'
    )
    await iframe.trigger('load')
    const web = vi.spyOn(window, 'open').mockReturnValue(null)
    const ask = vi.fn()
    view.element.addEventListener(ASK_EVENT, ask)
    for (const link of doc.querySelectorAll('a')) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      link.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    expect(web).toHaveBeenCalledExactlyOnceWith('https://example.test', '_blank', 'noopener')
    expect(openNote).toHaveBeenCalledExactlyOnceWith('Sample.md', '')
    expect(ask).toHaveBeenCalledTimes(1)
    expect((ask.mock.calls[0][0] as CustomEvent).detail).toEqual({ text: 'More please' })
    view.unmount()
  })

  it('shows escaped source when nothing safe can be drawn', () => {
    const view = mount(AgentView, { props: { html: '<script>alert(1)</script>' } })
    expect(view.find('iframe').exists()).toBe(false)
    expect(view.get('.abele-agent-view__broken').text()).toContain('can’t be shown')
    expect(view.get('code').text()).toBe('<script>alert(1)</script>')
    expect(view.find('script').exists()).toBe(false)
    view.unmount()
  })

  it('replaces a failed picture with an accessible placeholder and measures again', async () => {
    const view = mount(AgentView, { props: { html: '<p>Picture</p>' }, attachTo: document.body })
    const iframe = view.get('iframe')
    await nextTick()
    const doc = (iframe.element as HTMLIFrameElement).contentDocument!
    setFrameHtml(doc, '<img alt="Sample chair" class="cover">')
    await iframe.trigger('load')
    doc.querySelector('img')!.dispatchEvent(new Event('error'))
    expect(doc.querySelector('img')).toBeNull()
    expect(doc.querySelector('.picture.is-missing')?.getAttribute('aria-label')).toBe(
      'Sample chair'
    )
    view.unmount()
  })

  it('reads theme variables again after the host theme changes', async () => {
    document.body.style.setProperty('--text-normal', '#112233')
    const view = mount(AgentView, { props: { html: '<p>View</p>' } })
    await nextTick()
    expect(view.get('iframe').attributes('srcdoc')).toContain('#112233')
    document.body.style.setProperty('--text-normal', '#445566')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    expect(view.get('iframe').attributes('srcdoc')).toContain('#445566')
    view.unmount()
  })
})
