/**
 * Several interceptors in a row: the list numbers them in the order they run, names what each
 * reads, keeps a switched-off one in its place and opens an entry's settings under it.
 */
import { describe, it, expect, vi } from 'vitest'
import { Menu } from 'obsidian'
import { mount } from '@vue/test-utils'
import InterceptorList from '@/components/settings/ai/InterceptorList.vue'
import { moveEntry, type InterceptorEntry } from '@/components/settings/ai/interceptorList'

const entry = (id: string, agentId: string, extra: Partial<InterceptorEntry> = {}): InterceptorEntry => ({
  id,
  agentId,
  script: '',
  checks: 'answer',
  pattern: '',
  replyOnly: false,
  contextDepth: 0,
  enabled: true,
  ...extra,
})
const choices = [
  { value: 'sample-checker', display: 'Sample checker · utility' },
  { value: 'sample-editor', display: 'Sample editor' },
]

describe('InterceptorList', () => {
  it('numbers the entries in their order and says what each reads', () => {
    const view = mount(InterceptorList, {
      props: {
        entries: [
          entry('a', 'sample-checker'),
          entry('b', 'sample-editor', { checks: 'both', pattern: '^/fix' }),
          entry('c', 'sample-editor', { enabled: false }),
        ],
        choices,
      },
    })
    const rows = view.findAll('.abele-interceptors__entry')
    expect(rows.map((r) => r.get('.abele-interceptors__number').text())).toEqual(['1', '2', '3'])
    expect(rows[0].get('.abele-interceptors__name').text()).toBe('Sample checker')
    expect(rows[1].text()).toContain('Both · matching ^/fix')
    expect(rows[2].text()).toContain('Off')
  })

  it('opens an entry’s settings under it and adds a new one at the end', async () => {
    const view = mount(InterceptorList, { props: { entries: [entry('a', 'sample-checker')], choices } })
    await view.get('.abele-interceptors__name').trigger('click')
    expect(view.find('.abele-interceptors__settings').exists()).toBe(true)
    await view.findAll('button').find((b) => b.text().includes('Add interceptor'))!.trigger('click')
    const added = view.emitted('update:entries')!.at(-1)![0] as InterceptorEntry[]
    expect(added.map((e) => e.agentId)).toEqual(['sample-checker', 'sample-checker'])
    expect(new Set(added.map((e) => e.id)).size).toBe(2)
  })

  it('switches one off in its place, and its menu moves it or removes it', async () => {
    const shown: Menu[] = []
    vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockImplementation(function (this: Menu) {
      shown.push(this)
      return this
    })
    const entries = [entry('a', 'sample-checker'), entry('b', 'sample-editor')]
    const view = mount(InterceptorList, { props: { entries, choices } })
    await view.findAll('.checkbox-container')[0].trigger('click')
    expect((view.emitted('update:entries')!.at(-1)![0] as InterceptorEntry[])[0].enabled).toBe(false)

    await view.findAll('.abele-interceptors__entry')[1].find('[aria-label="Move or remove"]').trigger('click')
    const items = shown[0].items as unknown as { title: string; disabled: boolean; handler: () => void }[]
    expect(items.map((i) => [i.title, i.disabled])).toEqual([
      ['Move up', false],
      ['Move down', true],
      ['Remove', false],
    ])
    items[0].handler()
    expect((view.emitted('update:entries')!.at(-1)![0] as InterceptorEntry[]).map((e) => e.id)).toEqual(['b', 'a'])
    items[2].handler()
    expect((view.emitted('update:entries')!.at(-1)![0] as InterceptorEntry[]).map((e) => e.id)).toEqual(['a'])
  })

  it('a script names itself, and one no longer there says so', () => {
    const view = mount(InterceptorList, {
      props: { entries: [entry('s', '', { script: 'Sample gone' })], choices },
    })
    expect(view.get('.abele-interceptors__name').text()).toBe('Script: Sample gone · missing')
    expect(view.text()).toContain('script')
  })

  it('moves an entry without losing the others’ order', () => {
    expect(moveEntry(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(moveEntry(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })
})
