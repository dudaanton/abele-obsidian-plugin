/**
 * The question before highlight links are moved: every candidate with its chapter, its words and
 * the text around them, and a yes only from the repair button.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { closeComponentDialogs } from '@/modal/componentDialog'
import { askToRepairLinks } from '@/reader/highlightRepairDialog'
import type { HighlightRepairCandidate } from '@/reader/highlightRepair'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
afterEach(() => {
  closeComponentDialogs()
  document.body.replaceChildren()
})

const candidate = (i: number, anchored = true): HighlightRepairCandidate => ({
  cfi: `epubcfi(/6/2!/4/${i}:1)`,
  suggested: `epubcfi(/6/2!/4/${i + 1}:1)`,
  text: `Invented passage ${i}`,
  label: i === 1 ? '' : `Sample chapter ${i}`,
  context: { pre: 'Before the words. ', match: `Invented passage ${i}`, post: ' After them.' },
  anchored,
})
const modal = () => document.querySelector<HTMLElement>('.modal.abele-modal')!
const buttons = () =>
  [...modal().querySelectorAll<HTMLButtonElement>('button')].map((b) => b.textContent?.trim())
const press = (text: string) =>
  [...modal().querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => b.textContent?.trim() === text)!
    .click()

describe('askToRepairLinks', () => {
  it('lists one candidate and repairs only on its button', async () => {
    const { answer } = askToRepairLinks(null as never, [candidate(2, false)])
    await flushPromises()
    expect(modal().classList.contains('abele-modal_tall')).toBe(true)
    const text = modal().querySelector('.abele-modal__body')!.textContent!
    expect(text).toContain('These quoted words were found away from their saved links.')
    expect(text).toContain('Sample chapter 2')
    expect(text).toContain('“Invented passage 2”')
    expect(text).toContain('Before the words. Invented passage 2 After them.')
    expect(text).toContain('Saved location unavailable; this is a found occurrence.')
    expect(buttons()).toEqual(['Cancel', 'Repair link'])
    press('Repair link')
    await expect(answer).resolves.toBe(true)
  })

  it('counts several, names an untitled chapter, and is a no when cancelled', async () => {
    const { answer } = askToRepairLinks(null as never, [candidate(1), candidate(3)])
    await flushPromises()
    expect(modal().querySelectorAll('strong')[0].textContent).toBe('Untitled chapter')
    expect(modal().textContent).not.toContain('Saved location unavailable')
    expect(buttons()).toEqual(['Cancel', 'Repair 2 links'])
    press('Cancel')
    await expect(answer).resolves.toBe(false)
  })

  it('is a no when the reader cancels it', async () => {
    const dialog = askToRepairLinks(null as never, [candidate(2)])
    await flushPromises()
    dialog.cancel()
    await expect(dialog.answer).resolves.toBe(false)
    expect(document.querySelector('.modal.abele-modal')).toBeNull()
  })
})
