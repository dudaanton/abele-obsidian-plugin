import { expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, provide } from 'vue'
import { CARD_FOLDS, FOOTER_FOLD, useFooterFold, type Fold } from '@/composables/useFooterFold'
import { useVault } from '../helpers/testEnv'

it('opens the first card list, folds later lists, and never writes the tab fold state', () => {
  const app = useVault([])
  const save = vi.spyOn(app, 'saveLocalStorage')
  let tasks!: Fold
  let notes!: Fold
  const Child = defineComponent({
    setup() {
      tasks = useFooterFold('tasks')
      notes = useFooterFold('backlinks')
      return () => h('span')
    },
  })
  const view = mount(
    defineComponent({
      setup() {
        provide(FOOTER_FOLD, () => 'sample.md')
        provide(CARD_FOLDS, () => ['backlinks'])
        return () => h(Child)
      },
    })
  )
  try {
    expect(tasks.collapsed.value).toBe(false)
    expect(notes.collapsed.value).toBe(true)
    notes.toggle()
    expect(notes.collapsed.value).toBe(false)
    tasks.toggle()
    expect(tasks.collapsed.value).toBe(true)
    expect(save).not.toHaveBeenCalled()
  } finally {
    view.unmount()
  }
})
