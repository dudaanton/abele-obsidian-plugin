import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian'
import { columnsPostProcessor } from '@/columns/render'
import { changeColumns, createColumns, findColumns } from '@/columns/operations'
import { parseColumnsHeader } from '@/columns/core'

afterEach(() => vi.unstubAllGlobals())
describe('aside columns', () => {
  it.each(['aside-first', 'aside-collapse'])(
    'roundtrips the narrow policy %s without changing column content',
    (mobile) => {
      const text = createColumns('Sample body', 'aside')
      const frame = findColumns(text, 0)!
      expect(parseColumnsHeader(`[!abele-columns|ratio=2:1 mobile=${mobile}]`)).toEqual({
        ratio: [2, 1],
        mobile,
      })
      const changed = changeColumns(text, frame, { type: 'options', ratio: [2, 1], mobile } as any)
      expect(changed).toContain('[!abele-column|role=aside]')
      expect(changed).toContain('> > Sample body')
      expect(findColumns(changed, 0)?.options.mobile).toBe(mobile)
    }
  )
  it('assigns aside semantics, folds only on narrow panes and releases its observer', () => {
    let resize!: ResizeObserverCallback
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          resize = cb
        }
        observe() {}
        disconnect = disconnect
      }
    )
    const el = document.createElement('div')
    el.innerHTML =
      '<div class="callout" data-callout="abele-columns" data-callout-metadata="ratio=2:1 mobile=aside-collapse"><div class="callout-title">Columns</div><div class="callout-content"><div class="callout" data-callout="abele-column"><div class="callout-title"><div class="callout-title-inner">Body</div></div><div class="callout-content">Sample body</div></div><div class="callout" data-callout="abele-column" data-callout-metadata="role=aside"><div class="callout-title"><div class="callout-icon"></div><div class="callout-title-inner">Reference</div></div><div class="callout-content">Sample reference</div></div></div></div>'
    const parent = el.firstElementChild as HTMLElement
    let width = 342
    vi.spyOn(parent, 'clientWidth', 'get').mockImplementation(() => width)
    const children: MarkdownRenderChild[] = []
    const ctx = {
      addChild: (child: MarkdownRenderChild) => {
        children.push(child)
        child.load()
        return child
      },
    } as MarkdownPostProcessorContext
    columnsPostProcessor(el, ctx)
    const aside = el.querySelector<HTMLElement>('[data-abele-column-role="aside"]')!
    expect(aside).not.toBeNull()
    const title = aside.querySelector<HTMLElement>('.callout-title')!
    expect(title.getAttribute('role')).toBe('button')
    expect(title.getAttribute('aria-expanded')).toBe('false')
    expect(aside.dataset.abeleAsideCollapsed).toBe('true')
    title.click()
    expect(aside.dataset.abeleAsideCollapsed).toBe('false')
    title.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(title.getAttribute('aria-expanded')).toBe('false')
    width = 800
    resize([], {} as ResizeObserver)
    expect(aside.dataset.abeleAsideCollapsed).toBe('false')
    expect(title.hasAttribute('role')).toBe(false)
    width = 342
    resize([], {} as ResizeObserver)
    expect(aside.dataset.abeleAsideCollapsed).toBe('true')
    columnsPostProcessor(el, ctx)
    expect(children).toHaveLength(1)
    children[0].unload()
    expect(disconnect).toHaveBeenCalledOnce()
    title.click()
    expect(aside.dataset.abeleAsideCollapsed).toBe('true')
  })
  it('labels an untitled native aside without using the generated callout name', () => {
    const el = document.createElement('div')
    el.innerHTML =
      '<div class="callout" data-callout="abele-columns"><div class="callout-content"><div class="callout" data-callout="abele-column"></div><div class="callout" data-callout="abele-column" data-callout-metadata="role=aside"><div class="callout-title"><div class="callout-title-inner">Abele column</div></div></div></div></div>'
    columnsPostProcessor(el)
    expect(el.querySelector('.callout-title-inner')!.textContent).toBe('Aside')
  })

  it('changes one column role while retaining titles, bodies and existing child metadata', () => {
    const text = createColumns('Sample body', 'two').replace(
      '[!abele-column]',
      '[!abele-column|sample=value] Heading'
    )
    const changed = changeColumns(text, findColumns(text, 0)!, {
      type: 'role',
      index: 0,
      role: 'aside',
    } as any)
    expect(changed).toContain('[!abele-column|sample=value role=aside] Heading')
    expect(changed).toContain('> > Sample body')
    const back = changeColumns(changed, findColumns(changed, 0)!, {
      type: 'role',
      index: 0,
      role: 'main',
    } as any)
    expect(back).toContain('[!abele-column|sample=value] Heading')
  })
})
