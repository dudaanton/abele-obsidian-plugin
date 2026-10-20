import { afterEach, expect, it, vi } from 'vitest'
import { fitSuggestionAboveKeyboard } from '@/helpers/suggesters/shareSuggestionKeyboard'

afterEach(() => {
  document.documentElement.style.removeProperty('--keyboard-height')
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

it('keeps the native list above the keyboard when the page does not shrink', () => {
  const input = document.createElement('input')
  const popup = document.createElement('div')
  document.body.append(input, popup)
  input.focus()
  document.documentElement.style.setProperty('--keyboard-height', '300px')
  vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 340 } as DOMRect)
  vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue({
    top: 600,
    bottom: 800,
    height: 200,
  } as DOMRect)
  fitSuggestionAboveKeyboard(input, popup)
  expect(popup.style.top).toBe('95px')
  expect(popup.style.bottom).toBe('')
})

it('leaves native positioning alone without a keyboard', () => {
  const input = document.createElement('input')
  const popup = document.createElement('div')
  document.body.append(input, popup)
  input.focus()
  popup.style.top = '350px'
  fitSuggestionAboveKeyboard(input, popup)
  expect(popup.style.top).toBe('350px')
})

it('limits a tall list to the available room and keeps it scrollable', () => {
  const input = document.createElement('input')
  const popup = document.createElement('div')
  document.body.append(input, popup)
  input.focus()
  document.documentElement.style.setProperty('--keyboard-height', '300px')
  vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 340 } as DOMRect)
  vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue({
    top: 600,
    bottom: 1100,
    height: 500,
  } as DOMRect)
  fitSuggestionAboveKeyboard(input, popup)
  expect(popup.style.top).toBe('5px')
  expect(popup.style.maxHeight).toBe('290px')
})

it('does not reopen a dismissed field while the keyboard animates', () => {
  const input = document.createElement('input')
  const popup = document.createElement('div')
  document.body.append(input, popup)
  document.documentElement.style.setProperty('--keyboard-height', '300px')
  fitSuggestionAboveKeyboard(input, popup)
  expect(popup.style.top).toBe('')
})
