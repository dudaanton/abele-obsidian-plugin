/**
 * «/» at the start of a message: the chat's own commands, then skills, then prompts, in Obsidian's
 * suggestion list over the field. Skills and prompts used to be two tabs of the setup dialog.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatSlashSuggest from '@/components/ChatSlashSuggest.vue'
import { useVault } from '../helpers/testEnv'

const vault = () =>
  useVault([
    {
      path: 'Skills/summarize.md',
      frontmatter: { type: 'abele-skill', name: 'summarize', description: 'Sum up a note' },
    },
    {
      path: 'Prompts/Review my plan.md',
      frontmatter: { type: 'abele-prompt', description: 'Find the weak spots of a plan' },
    },
  ])

const titles = (view: ReturnType<typeof mount>) =>
  view.findAll('.suggestion-title').map((title) => title.text())

describe('the «/» list in the composer', () => {
  it('offers the commands first, then skills, then prompts', () => {
    vault()
    const view = mount(ChatSlashSuggest, { props: { query: '' } })
    expect(titles(view)).toEqual(['/compact', '/new', '/load', '/summarize', 'Review my plan'])
    // Each says what it is with a glyph at its end, in words only in the tooltip.
    expect(view.findAll('.suggestion-aux .abele-obsidian-icon')).toHaveLength(5)
  })

  it('narrows as the word after «/» is typed, by name and description', () => {
    vault()
    const view = mount(ChatSlashSuggest, { props: { query: 'weak' } })
    expect(titles(view)).toEqual(['Review my plan'])
  })

  it('offers only the commands where a session takes text alone', () => {
    vault()
    const view = mount(ChatSlashSuggest, { props: { query: '', textOnly: true } })
    expect(titles(view)).toEqual(['/compact', '/new', '/load'])
  })

  it('moves with the arrows and hands the chosen one on with Enter', async () => {
    vault()
    const view = mount(ChatSlashSuggest, { props: { query: '' } })
    const key = (k: string) =>
      (view.vm as unknown as { key: (e: KeyboardEvent) => boolean }).key(
        new KeyboardEvent('keydown', { key: k })
      )
    expect(key('ArrowDown')).toBe(true)
    expect(key('ArrowUp')).toBe(true)
    expect(key('ArrowUp')).toBe(true)
    await view.vm.$nextTick()
    expect(view.find('.suggestion-item.is-selected').text()).toContain('Review my plan')
    expect(key('Enter')).toBe(true)
    const [item] = view.emitted('choose')![0] as [{ kind: string; name: string }]
    expect(item).toMatchObject({ kind: 'prompt', name: 'Review my plan' })
    // Letters are the field's: the list does not take them.
    expect(key('a')).toBe(false)
  })

  it('draws nothing when nothing matches', () => {
    vault()
    const view = mount(ChatSlashSuggest, { props: { query: 'zzz' } })
    expect(view.find('.abele-chat-slash').exists()).toBe(false)
  })
})
