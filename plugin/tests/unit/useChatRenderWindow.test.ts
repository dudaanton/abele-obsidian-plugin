import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { useChatRenderWindow } from '@/composables/useChatRenderWindow'

const rows = (count: number) => Array.from({ length: count }, (_, i) => `sample-${i}`)

describe('bounded chat rendering', () => {
  it('rebudgets an already mounted destination after a folded run opens', async () => {
    const messages = rows(122)
    const expanded = ref(false)
    const window = useChatRenderWindow(
      () => messages,
      () => false,
      30,
      90,
      (start, end) => (expanded.value ? end - start : Math.min(3, end - start))
    )
    expect(window.start.value).toBe(0)
    expanded.value = true
    window.showFrom(107)
    await nextTick()
    expect(window.visible.value).toContain('sample-110')
    expect(window.end.value - window.start.value).toBeLessThanOrEqual(90)
  })

  it('keeps a completed reply mounted below a reader until the window is full', () => {
    const messages = ref(rows(2))
    const window = useChatRenderWindow(
      () => messages.value,
      () => false,
      3,
      9
    )
    messages.value.push('completed-reply')
    expect(window.visible.value).toContain('completed-reply')
    expect(window.hasNewer.value).toBe(false)
    messages.value.push(...rows(20).map((id) => `new-${id}`))
    expect(window.start.value).toBe(0)
    expect(window.visible.value).toHaveLength(9)
    expect(window.hasNewer.value).toBe(true)
  })

  it('evicts the old tail while following arriving messages', async () => {
    const messages = ref(rows(2000))
    const following = ref(true)
    const window = useChatRenderWindow(
      () => messages.value,
      () => following.value,
      30,
      90
    )
    expect(window.visible.value).toEqual(rows(2000).slice(-30))
    for (let i = 0; i < 200; i++) {
      messages.value.push(`new-${i}`)
      await nextTick()
      expect(window.visible.value.length).toBeLessThanOrEqual(90)
    }
    expect(window.visible.value.at(-1)).toBe('new-199')
    expect(window.visible.value).not.toContain('sample-1970')
  })

  it('unmounts newer pages while paging backward, and can load them again', () => {
    const messages = ref(rows(2000))
    const window = useChatRenderWindow(
      () => messages.value,
      () => false,
      30,
      90
    )
    for (let i = 0; i < 20; i++) {
      window.showOlder()
      expect(window.visible.value.length).toBeLessThanOrEqual(90)
    }
    expect(window.visible.value).not.toContain('sample-1999')
    const end = window.end.value
    window.showNewer()
    expect(window.end.value).toBeGreaterThan(end)
    expect(window.visible.value.length).toBeLessThanOrEqual(90)
  })

  it('does not move a middle reader when a new turn arrives', async () => {
    const messages = ref(rows(2000))
    const window = useChatRenderWindow(
      () => messages.value,
      () => false,
      30,
      90
    )
    window.showFrom(900)
    const before = [...window.visible.value]
    messages.value.push(...rows(200).map((id) => `new-${id}`))
    await nextTick()
    expect(window.visible.value).toEqual(before)
    expect(window.visible.value).toContain('sample-900')
    expect(window.visible.value.length).toBeLessThanOrEqual(90)
  })

  it('can reach both ends without growing the mounted window', () => {
    const messages = ref(rows(2000))
    const window = useChatRenderWindow(
      () => messages.value,
      () => false,
      30,
      90
    )
    for (let i = 0; i < 100; i++) window.showOlder()
    expect(window.start.value).toBe(0)
    expect(window.visible.value[0]).toBe('sample-0')
    for (let i = 0; i < 100; i++) window.showNewer()
    expect(window.end.value).toBe(2000)
    expect(window.visible.value.at(-1)).toBe('sample-1999')
    expect(window.visible.value.length).toBeLessThanOrEqual(90)
  })
})

it('splits edge reveals into smaller batches while preserving initial pages and capacity', () => {
  const messages = ref(rows(200))
  const window = useChatRenderWindow(
    () => messages.value,
    () => false,
    30,
    90
  )
  expect(window.visible.value).toHaveLength(30)
  const before = window.start.value
  window.showOlder(10)
  expect(window.start.value).toBe(before - 10)
  expect(window.visible.value).toHaveLength(40)
  window.showOlder()
  expect(window.start.value).toBe(before - 40)
  for (let i = 0; i < 30; i++) window.showOlder(10)
  expect(window.start.value).toBe(0)
  expect(window.visible.value).toHaveLength(90)
  const end = window.end.value
  window.showNewer(10)
  expect(window.end.value).toBe(end + 10)
  for (let i = 0; i < 30; i++) window.showNewer(10)
  expect(window.end.value).toBe(200)
  expect(window.visible.value).toHaveLength(90)
})
