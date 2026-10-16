import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ScopeEditor from '@/components/AiScopeEditor.vue'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { useVault } from '../helpers/testEnv'

import type { ScopeEntry } from '@/ai/ScopeResolver'

// The field's own list is the suggester's business (tests/unit/scopeSuggest.test.ts); here it
// is a stand-in that records what the editor hands it.
const suggesters = vi.hoisted(
  () =>
    [] as {
      input: HTMLInputElement
      taken: () => ScopeEntry[]
      onChoose: (entry: ScopeEntry) => void
      close: ReturnType<typeof vi.fn>
    }[]
)
vi.mock('@/helpers/suggesters/ScopeSuggest', () => ({
  ScopeSuggest: class {
    close = vi.fn()
    constructor(
      _app: unknown,
      public input: HTMLInputElement,
      public taken: () => ScopeEntry[],
      public onChoose: (entry: ScopeEntry) => void
    ) {
      suggesters.push(this)
    }
  },
}))

beforeEach(() => {
  useVault([])
  suggesters.length = 0
})
afterEach(() => {
  vi.restoreAllMocks()
})
describe('scope field', () => {
  it('is one field, mounted while access is narrowed and closed when it is broadened', async () => {
    const view = mount(ScopeEditor, { props: { entries: [], fullVaultAccess: true } })
    expect(suggesters).toHaveLength(0)
    expect(view.find('input').exists()).toBe(false)
    await view.setProps({ fullVaultAccess: false })
    expect(suggesters).toHaveLength(1)
    const input = view.get('input[placeholder="Add a note, folder, group or pattern…"]')
    expect(suggesters[0].input).toBe(input.element)
    expect(view.findAll('input')).toHaveLength(1)
    await view.setProps({ fullVaultAccess: true })
    expect(suggesters[0].close).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('adds whatever is chosen in it, once, and tells the list what is already there', async () => {
    const entries: ScopeEntry[] = [{ type: 'folder', path: 'Samples' }]
    const view = mount(ScopeEditor, { props: { entries, fullVaultAccess: false } })
    const [suggest] = suggesters
    expect(suggest.taken()).toEqual(entries)

    suggest.onChoose({ type: 'pattern', path: 'Samples/**/*.md' })
    expect(view.emitted('update:entries')).toEqual([
      [[...entries, { type: 'pattern', path: 'Samples/**/*.md' }]],
    ])
    suggest.onChoose({ type: 'folder', path: 'Samples' })
    expect(view.emitted('update:entries')).toHaveLength(1)
    view.unmount()
  })
})

describe('scope entries', () => {
  const entries = [
    { type: 'file' as const, path: 'Samples/one.md' },
    { type: 'group' as const, path: 'Samples/Sample group.md' },
  ]

  it('lists each place as a row with a remove glyph that leaves the others', async () => {
    const view = mount(ScopeEditor, { props: { entries, fullVaultAccess: false } })
    const rows = view.findAll('[role="list"] [role="listitem"]')
    expect(rows.map((r) => r.find('.abele-scope-mgr__entry-path').text())).toEqual([
      'Samples/one.md',
      'Samples/Sample group.md',
    ])
    await view.get('button[aria-label="Remove Samples/one.md from scope"]').trigger('click')
    expect(view.emitted('update:entries')).toEqual([[[entries[1]]]])
    view.unmount()
  })

  it("opens a group's row to show its members on a click and folds it on the next", async () => {
    vi.spyOn(ScopeResolver.getInstance(), 'groupCountsAsync').mockResolvedValue(
      new Map([['Samples/Sample group.md', 2]])
    )
    vi.spyOn(ScopeResolver.getInstance(), 'resolveGroupPathsAsync').mockImplementation(
      async (path) =>
        path === 'Samples/Sample group.md' ? ['Samples/member-a.md', 'Samples/member-b.md'] : []
    )
    const view = mount(ScopeEditor, { props: { entries, fullVaultAccess: false } })
    await vi.waitFor(() => expect(view.get('.abele-scope-mgr__entry-type').text()).toBe('2'))
    const group = view.findAll('[role="listitem"]')[1]
    expect(group.attributes('aria-expanded')).toBe('false')
    expect(group.get('.abele-scope-mgr__entry-type').text()).toBe('2')
    expect(view.find('.abele-scope-mgr__preview').exists()).toBe(false)

    await group.trigger('click')
    await vi.waitFor(() => expect(view.findAll('.abele-scope-mgr__preview-item')).toHaveLength(2))
    expect(view.findAll('[role="listitem"]')[1].attributes('aria-expanded')).toBe('true')
    expect(view.findAll('.abele-scope-mgr__preview-item').map((p) => p.text())).toEqual([
      'Samples/member-a.md',
      'Samples/member-b.md',
    ])
    await view.findAll('[role="listitem"]')[1].trigger('click')
    expect(view.find('.abele-scope-mgr__preview').exists()).toBe(false)
    // A file's row has nothing under it to open.
    await view.findAll('[role="listitem"]')[0].trigger('click')
    expect(view.find('.abele-scope-mgr__preview').exists()).toBe(false)
    view.unmount()
  })
})

/**
 * Each group row says how many notes the group holds, and the vault's whole metadata is what
 * answers it. One pass serves every row and every render after it, until the vault changes.
 */
describe('group rows on a large vault', () => {
  it('learns the members of every group in reach in one pass, kept across renders', async () => {
    const specs = [{ path: 'Sample hub.md' }, { path: 'Other hub.md' }, { path: 'Third hub.md' }]
    for (let i = 0; i < 1500; i++)
      specs.push({
        path: `Notes/Sample note ${i}.md`,
        frontmatter: { groups: [['[[Sample hub]]', '[[Other hub]]', '[[Third hub]]'][i % 3]] },
      } as never)
    const vault = useVault(specs)
    const groups: ScopeEntry[] = ['Sample hub.md', 'Other hub.md', 'Third hub.md'].map((path) => ({
      type: 'group',
      path,
    }))
    vault.resetStats()
    const view = mount(ScopeEditor, { props: { entries: groups, fullVaultAccess: false } })
    await vi.waitFor(() => expect(view.find('progress').exists()).toBe(false))
    expect(view.findAll('.abele-scope-mgr__entry-type').map((n) => n.text())).toEqual([
      '501',
      '501',
      '501',
    ])
    await view.findAll('[role="listitem"]')[0].trigger('click')
    await view.setProps({ entries: [...groups] })
    expect(vault.stats.getFileCache).toBeLessThanOrEqual(specs.length)
    view.unmount()
  })
})
