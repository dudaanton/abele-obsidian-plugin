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
  vi.unstubAllGlobals()
  document.body.removeAttribute('style')
})

function setFrameHtml(doc: Document, html: string) {
  const parsed = new DOMParser().parseFromString(cleanViewHtml(html), 'text/html')
  doc.body.replaceChildren(...Array.from(parsed.body.childNodes))
  doc.querySelectorAll('a').forEach((link, index) => {
    vi.spyOn(link, 'getClientRects').mockReturnValue([
      { left: 10, top: 10 + index * 30, right: 90, bottom: 30 + index * 30, width: 80, height: 20 },
    ] as unknown as DOMRectList)
  })
}

describe('agent view frame', () => {
  it('reattaches geometry when moving rendered markdown replaces the frame document without a load callback', async () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      callbacks.push(cb)
      return callbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const view = mount(AgentView, { props: { html: '<p>View</p>' }, attachTo: document.body })
    await nextTick()
    const iframe = view.get('iframe')
    const original = (iframe.element as HTMLIFrameElement).contentDocument!
    setFrameHtml(original, '<p>Off-page layout</p>')
    await iframe.trigger('load')
    expect(view.find('.abele-agent-view__hit').exists()).toBe(false)
    const replacement = new DOMParser().parseFromString('<body></body>', 'text/html')
    setFrameHtml(replacement, '<a href="abele:ask?text=More">More</a>')
    Object.defineProperty(iframe.element, 'contentDocument', {
      configurable: true,
      value: replacement,
    })
    callbacks.at(-1)!(1)
    await nextTick()
    expect(view.get('.abele-agent-view__hit').attributes('aria-label')).toBe('More')
    view.unmount()
  })
  it('updates parent geometry after frame scrolling/reflow and removes targets and tracking in source mode', async () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      callbacks.push(cb)
      return callbacks.length
    })
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const view = mount(AgentView, { props: { html: '<p>View</p>' }, attachTo: document.body })
    await nextTick()
    const iframe = view.get('iframe')
    Object.defineProperty(iframe.element, 'clientWidth', { configurable: true, value: 200 })
    Object.defineProperty(iframe.element, 'clientHeight', { configurable: true, value: 100 })
    const doc = (iframe.element as HTMLIFrameElement).contentDocument!
    setFrameHtml(doc, '<a href="abele:ask?text=More">More</a>')
    await iframe.trigger('load')
    let target = view.get('.abele-agent-view__hit')
    expect(target.attributes('style')).toContain('left: 10px')
    expect(target.attributes('style')).toContain('width: 80px')
    const attributes = vi.spyOn(target.element, 'setAttribute')
    callbacks.at(-1)!(0)
    await nextTick()
    expect(attributes).not.toHaveBeenCalled()
    // The markdown host also owns this DOM. Lost controls must be recreated, not patched
    // through stale virtual nodes after its post-processing/reparenting pass.
    target.element.remove()
    callbacks.at(-1)!(0)
    await nextTick()
    expect(view.findAll('.abele-agent-view__hit')).toHaveLength(1)
    const anchor = doc.querySelector('a')!
    vi.mocked(anchor.getClientRects).mockReturnValue([
      { left: 5, top: -10, right: 85, bottom: 10, width: 80, height: 20 },
    ] as unknown as DOMRectList)
    Object.defineProperty(iframe.element, 'clientWidth', { configurable: true, value: 50 })
    callbacks.at(-1)!(1)
    await nextTick()
    target = view.get('.abele-agent-view__hit')
    expect(target.attributes('style')).toContain('left: 5px')
    expect(target.attributes('style')).toContain('top: 0px')
    expect(target.attributes('style')).toContain('width: 45px')
    expect(target.attributes('style')).toContain('height: 10px')
    vi.mocked(anchor.getClientRects).mockReturnValue([
      { left: 5, top: 200, right: 45, bottom: 220, width: 40, height: 20 },
    ] as unknown as DOMRectList)
    callbacks.at(-1)!(2)
    await nextTick()
    expect(view.get('.abele-agent-view__hit').classes()).toContain('is-offscreen')
    vi.spyOn(anchor, 'scrollIntoView').mockImplementation(() => {
      vi.mocked(anchor.getClientRects).mockReturnValue([
        { left: 5, top: 20, right: 45, bottom: 40, width: 40, height: 20 },
      ] as unknown as DOMRectList)
    })
    await view.get('.abele-agent-view__hit').trigger('focus')
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    expect(view.get('.abele-agent-view__hit').classes()).not.toContain('is-offscreen')
    expect(view.get('.abele-agent-view__hit').attributes('style')).toContain('top: 20px')
    vi.mocked(anchor.getClientRects).mockReturnValue([
      { left: 5, top: 20, right: 45, bottom: 30, width: 40, height: 10 },
      { left: 5, top: 40, right: 45, bottom: 50, width: 40, height: 10 },
    ] as unknown as DOMRectList)
    callbacks.at(-1)!(3)
    await nextTick()
    expect(view.findAll('.abele-agent-view__hit')).toHaveLength(2)
    expect(view.findAll('.abele-agent-view__hit[tabindex="0"]')).toHaveLength(1)
    expect(view.findAll('.abele-agent-view__hit[aria-hidden="true"]')).toHaveLength(1)
    vi.mocked(anchor.getClientRects).mockReturnValue([] as unknown as DOMRectList)
    callbacks.at(-1)!(4)
    await nextTick()
    expect(view.findAll('.abele-agent-view__hit')).toHaveLength(0)
    vi.mocked(anchor.getClientRects).mockReturnValue([
      { left: 5, top: 20, right: 45, bottom: 40, width: 40, height: 20 },
    ] as unknown as DOMRectList)
    callbacks.at(-1)!(5)
    await nextTick()
    expect(view.findAll('.abele-agent-view__hit')).toHaveLength(1)
    expect(view.get('iframe').element).toBe(iframe.element)
    await view
      .findAllComponents({ name: 'Icon' })
      .find((icon) => icon.props('icon') === 'code-xml')!
      .trigger('click')
    expect(view.find('.abele-agent-view__hit').exists()).toBe(false)
    expect(cancel).toHaveBeenCalled()
    view.unmount()
  })
  it('routes touch-only and pointer taps once, captures clicks, and supports Enter', async () => {
    const view = mount(AgentView, { props: { html: '<p>View</p>' }, attachTo: document.body })
    await nextTick()
    const iframe = view.get('iframe')
    const doc = (iframe.element as HTMLIFrameElement).contentDocument!
    setFrameHtml(doc, '<a href="abele:ask?text=Compare"><span>Compare</span></a>')
    await iframe.trigger('load')
    const target = view.get('.abele-agent-view__hit').element
    expect(target.ownerDocument).toBe(document)
    expect(target.getAttribute('role')).toBe('link')
    expect(target.getAttribute('aria-label')).toBe('Compare')
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
    for (const link of view.element.querySelectorAll('.abele-agent-view__hit')) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      link.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    expect(web).toHaveBeenCalledExactlyOnceWith('https://example.test', '_blank', 'noopener')
    expect(openNote).toHaveBeenCalledExactlyOnceWith('Sample.md', '')
    expect(ask).toHaveBeenCalledTimes(1)
    expect((ask.mock.calls[0][0] as CustomEvent).detail).toEqual({ text: 'More please' })
    expect(doc.querySelectorAll('a[tabindex="0"]')).toHaveLength(0)
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
