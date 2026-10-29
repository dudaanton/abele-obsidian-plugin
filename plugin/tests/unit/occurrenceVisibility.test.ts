import { expect, it } from 'vitest'
import { transparentOccurrenceColor } from '../e2e/helpers/occurrenceVisibility'

it.each(['rgb(0, 0, 0)', 'rgb(255, 208, 0)', 'oklch(0.6 0.2 290 / 0.33)'])(
  'recognizes opaque or visible colour %s',
  (color) => expect(transparentOccurrenceColor(color)).toBe(false)
)
it.each(['', 'transparent', 'rgba(0, 0, 0, 0)', 'oklch(0.6 0.2 290 / 0)'])(
  'recognizes transparent colour %s',
  (color) => expect(transparentOccurrenceColor(color)).toBe(true)
)
it('can run inside the page without module dependencies', () => {
  const check = new Function(`return (${transparentOccurrenceColor.toString()})`)()
  expect(check('rgb(0, 0, 0)')).toBe(false)
})
