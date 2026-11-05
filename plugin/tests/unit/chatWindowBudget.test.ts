import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { useChatRenderWindow } from '@/composables/useChatRenderWindow'

describe('chat rendering budget', () => {
  it('retains both ends of a short collapsed run without evicting its reply', () => {
    const messages = ref(Array.from({ length: 122 }, (_, i) => i))
    const window = useChatRenderWindow(
      () => messages.value,
      () => true,
      30,
      90,
      (start, end) => Number(start === 0) + Number(end > 1 && start < 121) * 2 + Number(end > 121)
    )
    expect(window.start.value).toBe(0)
    expect(window.end.value).toBe(122)
  })

  it('prefills older content without discarding the current tail', () => {
    const window = useChatRenderWindow(
      () => Array.from({ length: 200 }, (_, i) => i),
      () => false
    )
    window.expandOlder()
    window.expandOlder()
    expect(window.start.value).toBe(110)
    expect(window.end.value).toBe(200)
    expect(window.expandOlder()).toBe(false)
    expect(window.end.value).toBe(200)
  })

  it('keeps mounted content bounded when a folded run expands', async () => {
    const expanded = ref(false)
    const window = useChatRenderWindow(
      () => Array.from({ length: 120 }, (_, i) => i),
      () => false,
      30,
      90,
      (start, end) => (expanded.value ? end - start : Number(end > start))
    )
    expect(window.visible.value).toHaveLength(120)
    expanded.value = true
    await nextTick()
    expect(window.visible.value).toHaveLength(90)
    expect(window.start.value).toBe(0)
  })
})
