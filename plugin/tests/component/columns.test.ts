import { describe, expect, it } from 'vitest'
import 'obsidian'
import { columnsPostProcessor } from '@/columns/render'

function fixture(extra?: HTMLElement) {
  const el = document.createElement('div')
  el.innerHTML = `<div class="callout" data-callout="abele-columns" data-callout-metadata="ratio=2:1 mobile=stack">
    <div class="callout-title">Columns</div><div class="callout-content">
      <div class="callout" data-callout="abele-column"><div class="callout-title">First</div><div class="callout-content"><input type="checkbox">Keep the task</div></div>
      <div class="callout" data-callout="abele-column"><div class="callout-title">Second</div><div class="callout-content"><table><tr><td>Keep the table</td></tr></table></div></div>
    </div></div>`
  if (extra) {
    const content = el.querySelector('.callout-content')!
    content.insertBefore(extra, content.lastElementChild)
  }
  return el
}

describe('columns over native callout DOM', () => {
  it('keeps native content, events and order instead of rerendering it', () => {
    const el = fixture()
    const task = el.querySelector('input')!
    let clicked = false
    task.addEventListener('click', () => {
      clicked = true
    })
    columnsPostProcessor(el)
    expect(el.querySelector('.abele-columns')).not.toBeNull()
    expect([...el.querySelectorAll('.abele-column')].map((c) => c.textContent?.trim())).toEqual([
      'FirstKeep the task',
      'SecondKeep the table',
    ])
    expect(el.querySelectorAll('.abele-column')[0].getAttribute('style')).toContain(
      '--abele-column-weight: 2'
    )
    expect(el.querySelector('input')).toBe(task)
    expect(el.querySelector('table')!.parentElement!.classList.contains('abele-column-table')).toBe(
      true
    )
    expect(el.querySelector('input')!.closest('.abele-column-table')).toBeNull()
    task.click()
    expect(clicked).toBe(true)
    columnsPostProcessor(el)
    expect(el.querySelectorAll('input')).toHaveLength(1)
  })

  it('also handles the callout itself as the processor root', () => {
    const el = fixture()
    columnsPostProcessor(el.firstElementChild as HTMLElement)
    expect(el.querySelector('.abele-columns')).not.toBeNull()
  })

  it('does not mistake embedded or deeper callouts for direct columns', () => {
    const embed = document.createElement('div')
    embed.className = 'internal-embed'
    embed.innerHTML = '<div class="callout" data-callout="abele-column">Embedded</div>'
    const el = fixture(embed)
    columnsPostProcessor(el)
    expect(el.querySelector('.abele-columns')).toBeNull()
    expect(el.textContent).toContain('Embedded')
  })

  it('leaves mismatched ratios, folding and extra parent content as ordinary callouts', () => {
    for (const change of [
      (el: HTMLElement) =>
        el.querySelector('.callout')!.setAttribute('data-callout-metadata', 'ratio=1:1:1'),
      (el: HTMLElement) => el.querySelector('.callout')!.classList.add('is-collapsible'),
      (el: HTMLElement) =>
        el.querySelector('[data-callout="abele-column"]')!.classList.add('is-collapsible'),
    ]) {
      const el = fixture()
      change(el)
      columnsPostProcessor(el)
      expect(el.querySelector('.abele-columns')).toBeNull()
    }
    const paragraph = document.createElement('p')
    paragraph.textContent = 'Unassigned text'
    const el = fixture(paragraph)
    columnsPostProcessor(el)
    expect(el.querySelector('.abele-columns')).toBeNull()
    expect(el.textContent).toContain('Unassigned text')
  })
})
