import { expect, it, vi } from 'vitest'
import { effectScope, nextTick, watch } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { settingsSlice } from '@/composables/settingsSlice'

it('publishes only own fields, including nested in-place edits and received replacements', async () => {
  const config = AbeleConfig.getInstance()
  config.reader = { fontSize: 18 } as never
  config.headerButtons = []
  config.calendars = { feeds: [] } as never
  const scope = effectScope()
  const books = vi.fn(),
    calendars = vi.fn(),
    buttons = vi.fn()
  scope.run(() => {
    watch(
      settingsSlice((c) => ({ reader: c.reader, ai: c.ai?.enabled })),
      books
    )
    watch(
      settingsSlice((c) => c.calendars),
      calendars
    )
    watch(
      settingsSlice((c) => c.headerButtons),
      buttons
    )
  })
  try {
    for (let i = 0; i < 10; i++) {
      config.version.value++
      await nextTick()
    }
    expect(books).toHaveBeenCalledTimes(0)
    expect(calendars).toHaveBeenCalledTimes(0)
    expect(buttons).toHaveBeenCalledTimes(0)
    config.reader.fontSize = 20
    config.version.value++
    await nextTick()
    expect(books).toHaveBeenCalledTimes(1)
    config.reader = { fontSize: 20 } as never
    config.version.value++
    await nextTick()
    expect(books).toHaveBeenCalledTimes(1)
    config.headerButtons.push({ id: 'sample' } as never)
    config.version.value++
    await nextTick()
    expect(buttons).toHaveBeenCalledTimes(1)
    expect(calendars).toHaveBeenCalledTimes(0)
    config.calendars.feeds.push({ id: 'sample' } as never)
    config.version.value++
    await nextTick()
    expect(calendars).toHaveBeenCalledTimes(1)
  } finally {
    scope.stop()
  }
})
