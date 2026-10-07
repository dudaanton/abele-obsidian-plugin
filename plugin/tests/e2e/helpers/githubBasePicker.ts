import { BASE_SHA, TAG } from './fakeGithubRepo'
import { outwardBoxShadowReach } from '../../helpers/focusRingPaint'

/** Open the real picker from a real file tab against the injected fake server. */
export const openBasePicker = (web: string) => `
  const leaf = await openTab(${JSON.stringify(`${web}/blob/main/src/app.ts`)})
  const root = leaf.view.containerEl
  if (!(await until(() => loaded(leaf, 'src/app.ts'), 20000))) throw Error('The file did not load')
  const chooseBase = [...root.querySelectorAll('button')].find(b => b.textContent === 'Compare against…' || b.textContent === 'Change base')
  if (!chooseBase) throw Error('No comparison base action')
  chooseBase.click()
  const prompt = await until(() => document.querySelector('.abele-github-base-picker'), 5000)
  if (!prompt) throw Error('The base picker did not open')
  const input = prompt.querySelector('input')
  input.value = ${JSON.stringify(TAG)}
  input.dispatchEvent(new Event('input', { bubbles: true }))
  if (!(await until(() => prompt.querySelector('.suggestion-note')?.textContent.includes(${JSON.stringify(BASE_SHA)}), 20000))) throw Error('The resolved base SHA did not show')
`

/** Measure the native prompt, including the focus ring outside its field's box. */
export const basePickerGeometry = `
  input.focus()
  const cs = getComputedStyle(input), bounds = input.getBoundingClientRect()
  const reach = Math.max((${outwardBoxShadowReach.toString()})(cs.boxShadow), cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || '0'))
  const clipped = []
  for (let p = input.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const s = getComputedStyle(p), r = p.getBoundingClientRect()
    if (s.overflowX !== 'visible' && (bounds.left - reach < r.left + p.clientLeft - 0.5 || bounds.right + reach > r.left + p.clientLeft + p.clientWidth + 0.5)) clipped.push(p.className)
  }
  const over = [...prompt.querySelectorAll('input, .suggestion-content')].filter(el => {
    const r = el.getBoundingClientRect()
    return r.width && (r.left < -1 || r.right > innerWidth + 1)
  }).map(el => el.className)
  const pickerReport = { clipped, over, sha: prompt.querySelector('.suggestion-note')?.textContent, width: bounds.width }
`
