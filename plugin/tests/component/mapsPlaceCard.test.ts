import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import MapPlaceCard from '@/components/mapBase/MapPlaceCard.vue'

vi.mock('@/components/obsidian/Markdown.vue', () => ({
  default: { props: ['text'], template: '<article>{{ text }}</article>' },
}))
const place = {
  id: 'sample',
  path: 'Sample.md',
  title: 'Sample',
  lat: 12,
  lon: 20,
  properties: [
    { name: 'Kind', value: 'Grove' },
    { name: 'Access', value: 'Public' },
  ],
}
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((w) => w.unmount()))
function card(props = {}) {
  const w = mount(MapPlaceCard, { props: { place, ...props } })
  wrappers.push(w)
  return w
}

it('reads asynchronously and ignores a slow result from a previous place', async () => {
  let finish!: (value: any) => void
  const loadPlace = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValue({ state: 'ready', text: 'Current note', photos: [] })
  const w = card({ loadPlace })
  expect(w.text()).toContain('Loading')
  await w.setProps({ place: { ...place, id: 'next', path: 'Next.md' } })
  await flushPromises()
  expect(w.text()).toContain('Current note')
  finish({ state: 'ready', text: 'Old note' })
  await flushPromises()
  expect(w.text()).not.toContain('Old note')
  expect(w.text()).toContain('Access')
})

it('shows deletion and load failures without exposing stale note content', async () => {
  const loadPlace = vi
    .fn()
    .mockResolvedValueOnce({ state: 'ready', text: 'Note body' })
    .mockResolvedValueOnce({ state: 'deleted' })
    .mockRejectedValueOnce(Error('read'))
  const w = card({ loadPlace })
  await flushPromises()
  expect(w.text()).toContain('Note body')
  await w.setProps({ contentToken: 1 })
  await flushPromises()
  expect(w.text()).toContain('This note is gone')
  expect(w.text()).not.toContain('Note body')
  await w.setProps({ contentToken: 2 })
  await flushPromises()
  expect(w.text()).toContain('could not be read')
})

it('turns failed thumbnail loads into missing images and skips them in photo events', async () => {
  const w = card({ place: { ...place, photos: [{ path: 'sample.png', url: 'app://sample' }] } })
  await w.get('img').trigger('error')
  await nextTick()
  expect(w.find('img').exists()).toBe(false)
  expect(w.find('.abele-map-card__photo-missing').exists()).toBe(true)
  expect(w.find('.abele-map-card__photo-missing').attributes('aria-label')).toBe(
    'sample.png could not be loaded'
  )
})

it('keeps note actions in the modal footer while a long body scrolls', async () => {
  const footer = document.body.createDiv()
  try {
    const w = card({
      footerHost: footer,
      place: { ...place, text: 'A long sample note. '.repeat(100) },
    })
    await nextTick()
    const open = footer.querySelector('button')
    expect(open?.textContent).toBe('Open')
    expect(w.find('article').text()).toContain('A long sample note.')
    open?.click()
    expect(w.emitted('open')).toHaveLength(1)
  } finally {
    footer.remove()
  }
})
