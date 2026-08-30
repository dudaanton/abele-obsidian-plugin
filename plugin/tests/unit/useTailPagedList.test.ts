/**
 * Rendering the end of a conversation, and growing towards its start.
 *
 * The mirror image of `usePagedList`, and the differences are the point: the slice is taken
 * from the end rather than the beginning, so what arrives while the list is open is inside
 * the window without anything having to notice it — which is what lets a streamed message
 * appear however far back the reader has scrolled.
 */
import { describe, it, expect } from 'vitest'
import { ref, nextTick } from 'vue'
import { useTailPagedList } from '@/composables/useTailPagedList'

const upTo = (n: number): string[] => Array.from({ length: n }, (_, i) => `m${i + 1}`)

describe('what is rendered', () => {
  it('renders the last page, not the first', () => {
    const { visible } = useTailPagedList(() => upTo(10), 3)

    expect(visible.value).toEqual(['m8', 'm9', 'm10'])
  })

  it('renders everything when the list is shorter than a page', () => {
    const { visible, hasMore } = useTailPagedList(() => upTo(2), 3)

    expect(visible.value).toEqual(['m1', 'm2'])
    expect(hasMore.value).toBe(false)
  })

  it('renders nothing for an empty list, and asks for nothing more', () => {
    const { visible, hasMore, hidden } = useTailPagedList(() => [], 3)

    expect(visible.value).toEqual([])
    expect(hasMore.value).toBe(false)
    expect(hidden.value).toBe(0)
  })

  it('counts what it is holding back', () => {
    const { hidden, total } = useTailPagedList(() => upTo(10), 3)

    expect(hidden.value).toBe(7)
    expect(total.value).toBe(10)
  })
})

describe('growing towards the start', () => {
  it('reveals a page of older entries, keeping the ones already shown', () => {
    const { visible, showMore } = useTailPagedList(() => upTo(10), 3)

    showMore()

    expect(visible.value).toEqual(['m5', 'm6', 'm7', 'm8', 'm9', 'm10'])
  })

  it('stops at the start of the list', () => {
    const { visible, hasMore, showMore } = useTailPagedList(() => upTo(4), 3)

    showMore()
    showMore()

    expect(visible.value).toEqual(upTo(4))
    expect(hasMore.value).toBe(false)
  })

  it('does nothing when there is nothing older', () => {
    const { visible, showMore } = useTailPagedList(() => upTo(2), 3)

    showMore()

    expect(visible.value).toEqual(['m1', 'm2'])
  })
})

describe('a list that changes while it is open', () => {
  it('renders an entry added at the end without being asked', () => {
    const source = ref(upTo(3))
    const { visible } = useTailPagedList(() => source.value, 3)

    source.value = [...source.value, 'm4']

    expect(visible.value.at(-1)).toBe('m4')
  })

  /**
   * The window is anchored at its start, not at its end. A window of "the last three" moves
   * forward on every append, dropping the oldest rendered entry — which in a chat takes a
   * message's worth of height out from above whoever is reading and shifts the page up under
   * them. An agent's reply appends several in a row, so scrolling back mid-reply was hopeless.
   */
  it('drops nothing from the top when something is added at the bottom', () => {
    const source = ref(upTo(10))
    const { visible } = useTailPagedList(() => source.value, 3)
    const before = [...visible.value]

    source.value = [...source.value, 'm11']

    expect(visible.value).toEqual([...before, 'm11'])
  })

  it("holds the top still through a whole reply's worth of them", () => {
    const source = ref(upTo(10))
    const { visible, hidden } = useTailPagedList(() => source.value, 3)

    for (const extra of ['m11', 'm12', 'm13', 'm14']) source.value = [...source.value, extra]

    expect(visible.value[0]).toBe('m8')
    expect(hidden.value).toBe(7)
  })

  it('keeps a grown window growing with the list, so streaming stays visible', () => {
    const source = ref(upTo(10))
    const { visible, showMore } = useTailPagedList(() => source.value, 3)
    showMore()

    source.value = [...source.value, 'm11']

    expect(visible.value.at(-1)).toBe('m11')
    expect(visible.value[0]).toBe('m5')
  })

  it('starts again at the end when the list is replaced by a shorter one', async () => {
    const source = ref(upTo(20))
    const { visible, showMore } = useTailPagedList(() => source.value, 3)
    showMore()
    showMore()

    // Another conversation: shorter, and nothing to do with the window grown for the last.
    source.value = upTo(12)
    await nextTick()

    expect(visible.value).toEqual(['m10', 'm11', 'm12'])
  })

  it('can be sent back to the end deliberately', () => {
    const { visible, showMore, reset } = useTailPagedList(() => upTo(10), 3)
    showMore()

    reset()

    expect(visible.value).toEqual(['m8', 'm9', 'm10'])
  })
})
