import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ScopeEditor from '@/components/AiScopeEditor.vue'
import { useVault } from '../helpers/testEnv'

const suggesters = vi.hoisted(
  () =>
    [] as {
      selectSuggestion: (item: { path: string }) => void
      close: ReturnType<typeof vi.fn>
      refresh: ReturnType<typeof vi.fn>
      allFileTypes?: boolean
    }[]
)
vi.mock('@/helpers/suggesters/FileSuggester', () => ({
  FileSuggest: class {
    close = vi.fn()
    refresh = vi.fn()
    selectSuggestion = (_item: { path: string }) => {}
    allFileTypes?: boolean
    constructor(_app: unknown, _input: unknown, options?: { allFileTypes?: boolean }) {
      this.allFileTypes = options?.allFileTypes
      suggesters.push(this)
    }
  },
}))
vi.mock('@/helpers/suggesters/FolderSuggester', () => ({
  FolderSuggest: class {
    close = vi.fn()
    refresh = vi.fn()
    selectSuggestion = (_item: { path: string }) => {}
    constructor() {
      suggesters.push(this)
    }
  },
}))

beforeEach(() => {
  useVault([])
  suggesters.length = 0
})
describe('scope fields', () => {
  it('mounts suggesters after full access is narrowed and closes them when broadened', async () => {
    const view = mount(ScopeEditor, { props: { entries: [], fullVaultAccess: true } })
    expect(suggesters).toHaveLength(0)
    await view.setProps({ fullVaultAccess: false })
    expect(suggesters).toHaveLength(3)
    expect(suggesters[0].allFileTypes).toBe(true)
    for (const [index, type] of ['file', 'folder', 'group'].entries()) {
      suggesters[index].selectSuggestion({ path: `Samples/${type}.md` })
      expect(view.emitted('update:entries')?.[index]).toEqual([
        [{ type, path: `Samples/${type}.md` }],
      ])
    }
    await view.setProps({ fullVaultAccess: true })
    suggesters.forEach((s) => expect(s.close).toHaveBeenCalledOnce())
    view.unmount()
  })
  it('adds a trimmed pattern once on Enter and clears the input', async () => {
    const view = mount(ScopeEditor, { props: { entries: [], fullVaultAccess: false } })
    const input = view.get('input[placeholder="e.g. Projects/**/*.md"]')
    await input.setValue(' Samples/**/*.md ')
    await input.trigger('keydown.enter')
    expect(view.emitted('update:entries')).toEqual([
      [[{ type: 'pattern', path: 'Samples/**/*.md' }]],
    ])
    expect((input.element as HTMLInputElement).value).toBe('')
    view.unmount()
  })
})
