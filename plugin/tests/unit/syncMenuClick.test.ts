import { expect, it, vi } from 'vitest'
import { clickSyncMenu } from '../e2e/helpers/syncMenuClick'

it('opens the connection menu at the centre of its real button, bubbling to its owner', () => {
  const row = document.createElement('div')
  const button = document.createElement('button')
  button.className = 'abele-obsidian-icon'
  const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  glyph.setAttribute('class', 'lucide-more-horizontal')
  button.append(glyph)
  row.append(button)
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 200, 32, 24))
  const clicked = vi.fn((event: MouseEvent) => ({ x: event.clientX, y: event.clientY }))
  row.addEventListener('click', clicked)
  clickSyncMenu(row)
  expect(clicked).toHaveBeenCalledOnce()
  expect(clicked.mock.results[0].value).toEqual({ x: 316, y: 212 })
})
