import { expect, it, vi } from 'vitest'
import { useFakeClock } from '../../helpers/fakeClock'

const advance = useFakeClock()
// The stack frame represents the write-behind producer the guard recognises.
function useSettingsSave() {
  return setTimeout(() => {}, 500)
}

it('left pending', () => {
  useSettingsSave()
  expect(vi.getTimerCount()).toBe(1)
})

class ChatSession {
  markDirty() {
    setTimeout(() => {}, 500)
  }
}
class BookBookmarks {
  schedule() {
    setTimeout(() => {}, 500)
  }
}
class BookPlaces {
  schedule() {
    setTimeout(() => {}, 500)
  }
}
class PdfInk {
  changed() {
    setTimeout(() => {}, 500)
  }
}
class GithubUsers {
  scheduleSave() {
    setTimeout(() => {}, 500)
  }
}

it.each([
  ['chat', () => new ChatSession().markDirty()],
  ['bookmarks', () => new BookBookmarks().schedule()],
  ['places', () => new BookPlaces().schedule()],
  ['ink', () => new PdfInk().changed()],
  ['users', () => new GithubUsers().scheduleSave()],
] as const)('left pending from %s', (_, schedule) => {
  schedule()
  expect(vi.getTimerCount()).toBe(1)
})

it('cancelled', () => {
  clearTimeout(useSettingsSave())
})

it('completed', async () => {
  useSettingsSave()
  await advance(500)
})
