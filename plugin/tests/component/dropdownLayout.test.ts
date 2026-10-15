/**
 * What a screen full of the kit's dropdowns costs the window. Obsidian sizes each of its selects
 * to the choice it shows by writing it into a measuring select and reading that one's width, and
 * a read after a write is a layout of the whole window. A hundred dropdowns, one per tool on an
 * agent's Access tab, measured one at a time is a hundred layouts; measured together, one.
 *
 * The stand-in below measures exactly as Obsidian's does — on a new value, on a change, and once
 * inserted — and writes down every write and read in order. A layout is a read that follows a
 * write, so that is what is counted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

const log = vi.hoisted(() => ({ ops: [] as string[], built: 0 }))

vi.mock('obsidian', async (original) => {
  const real = await original<typeof import('obsidian')>()
  class MeasuringDropdown extends real.DropdownComponent {
    measureEl: HTMLSelectElement
    measureOptionEl: HTMLOptionElement
    constructor(containerEl: HTMLElement) {
      super(containerEl)
      log.built++
      this.measureEl = containerEl.ownerDocument.createElement('select')
      this.measureOptionEl = containerEl.ownerDocument.createElement('option')
      this.measureEl.append(this.measureOptionEl)
      containerEl.append(this.measureEl)
      const option = this.measureOptionEl
      let text = ''
      Object.defineProperty(option, 'text', {
        get: () => text,
        set: (value: string) => {
          log.ops.push('write')
          text = value
        },
      })
      const setProperty = this.selectEl.style.setProperty.bind(this.selectEl.style)
      this.selectEl.style.setProperty = (name: string, value: string | null) => {
        log.ops.push('write')
        setProperty(name, value)
      }
      Object.defineProperty(this.measureEl, 'offsetWidth', {
        get: () => {
          log.ops.push('read')
          return option.text.length * 7
        },
      })
      // Obsidian measures a select once it is in the document, a moment after.
      setTimeout(() => this.resizeToFit(), 0)
      this.selectEl.addEventListener('change', () => this.resizeToFit())
    }
    resizeToFit(): void {
      const chosen = this.selectEl.options[this.selectEl.selectedIndex]
      if (!chosen) return
      this.measureOptionEl.text = chosen.text
      this.selectEl.style.setProperty('--dropdown-fitted-width', `${this.measureEl.offsetWidth}px`)
    }
    setValue(value: string): this {
      super.setValue(value)
      this.resizeToFit()
      return this
    }
  }
  return { ...real, DropdownComponent: MeasuringDropdown }
})

const { default: Dropdown } = await import('@/components/obsidian/Dropdown.vue')

const layouts = () =>
  log.ops.filter(
    (op, i) => op === 'read' && log.ops.slice(0, i).includes('write') && log.ops[i - 1] === 'write'
  ).length

const settle = async () => {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => requestAnimationFrame(() => r(undefined)))
  await new Promise((r) => setTimeout(r, 120))
}

const modes = ['off', 'ask', 'auto']
function screen(count: number) {
  const values = ref(Array.from({ length: count }, (_, i) => modes[i % 3]))
  const renders = ref(0)
  const Host = defineComponent({
    setup: () => () =>
      h(
        'div',
        { 'data-renders': renders.value },
        values.value.map((value, i) =>
          h(Dropdown, {
            key: i,
            modelValue: value,
            // Inline, as the screens write them: a new array on every render.
            options: [
              { value: 'off', display: 'Off' },
              { value: 'ask', display: 'Ask' },
              { value: 'auto', display: 'Auto' },
            ],
          })
        )
      ),
  })
  const view = mount(Host, { attachTo: document.body })
  return { view, values, renders }
}

beforeEach(() => {
  log.ops = []
  log.built = 0
})

describe('a screen of dropdowns', () => {
  it('lays the window out once for all of them, not once each', async () => {
    const { view } = screen(60)
    await settle()
    const selects = view.findAll('select.abele-obsidian-dropdown__base')
    expect(selects).toHaveLength(60)
    // Every select is sized to the choice it shows, as Obsidian would size it.
    expect(
      selects.map((s) =>
        (s.element as HTMLElement).style.getPropertyValue('--dropdown-fitted-width')
      )
    ).toEqual(Array.from({ length: 60 }, (_, i) => `${['Off', 'Ask', 'Auto'][i % 3].length * 7}px`))
    expect(layouts()).toBeLessThanOrEqual(2)
    view.unmount()
  })

  it('neither rebuilds nor measures them again when the screen around them is drawn again', async () => {
    const { view, renders } = screen(30)
    await settle()
    const built = log.built
    log.ops = []
    renders.value++
    await settle()
    expect(log.built).toBe(built)
    expect(log.ops).toEqual([])
    view.unmount()
  })

  it('measures only the one whose value changed', async () => {
    const { view, values } = screen(30)
    await settle()
    log.ops = []
    values.value = values.value.map((v, i) => (i === 4 ? 'auto' : v))
    await settle()
    const select = view.findAll('select.abele-obsidian-dropdown__base')[4]
      .element as HTMLSelectElement
    expect(select.value).toBe('auto')
    expect(select.style.getPropertyValue('--dropdown-fitted-width')).toBe('28px')
    expect(log.ops.filter((op) => op === 'read')).toHaveLength(1)
    view.unmount()
  })

  it('sizes a select to the choice picked in it', async () => {
    const { view } = screen(3)
    await settle()
    const select = view.findAll('select.abele-obsidian-dropdown__base')[0]
    await select.setValue('auto')
    await settle()
    expect((select.element as HTMLElement).style.getPropertyValue('--dropdown-fitted-width')).toBe(
      '28px'
    )
    view.unmount()
  })
})
