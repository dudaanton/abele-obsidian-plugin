import { expect, it } from 'vitest'
import { fitSidebarInputWidths } from '../e2e/helpers/sidebarInputViewport'

it('fits oversized saved sidebars for native input and retains their exact restore sizes', () => {
  const sidebar = (size: number) => ({
    size,
    setSize(next: number) {
      this.size = next
    },
  })
  const sidebars = [sidebar(300), sidebar(1500)]
  const saved = fitSidebarInputWidths(sidebars, 1280)
  expect(saved).toEqual([300, 1500])
  expect(sidebars.map((item) => item.size)).toEqual([300, 426])
  sidebars.forEach((item, index) => item.setSize(saved[index]))
  expect(sidebars.map((item) => item.size)).toEqual([300, 1500])
})
