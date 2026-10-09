import { outwardBoxShadowReach } from '../../helpers/focusRingPaint'
// Inventory is by intended anatomy, not only [tabindex]/button: broken semantics must be seen.
export const CATALOGUE_PROBE = String.raw`
const root = document.querySelector('.abele-design-catalogue')
if (!root) throw Error('Catalogue not mounted')
const modal = root.closest('.modal')
const intended = [...root.querySelectorAll('.abele-list-row__main, .abele-list-row__actions .abele-obsidian-icon, .abele-sheet-header-actions .abele-obsidian-icon, .abele-disclosure__control, .abele-swatch-picker__choice, .abele-path-label > summary, .abele-relative-time summary, .abele-image__preview, .abele-quote > .abele-obsidian-icon, .abele-swatch-picker__underline')]
const failures = []
const shadowReach = ${outwardBoxShadowReach.toString()}
for (const el of intended) {
  const initial = el.getBoundingClientRect()
  if (!initial.width || !initial.height) continue // collapsed detail, not an intended visible action
  const label = el.getAttribute('aria-label') || el.textContent.trim()
  if (!label) failures.push('unnamed action')
  if (!(el.matches('button,summary') || el.getAttribute('role') === 'button')) failures.push('no keyboard semantics: ' + label)
  if (app.isMobile && (initial.width < 43.9 || initial.height < 43.9)) failures.push('small target: ' + label + ' ' + initial.width + 'x' + initial.height)
  if (el.matches('.abele-list-row__main') && el.scrollHeight > el.clientHeight + 1) failures.push('title clipped by control height: ' + label)
  if (el.disabled) continue
  el.scrollIntoView({ block: 'nearest' }); el.focus()
  if (document.activeElement !== el) failures.push('unfocusable: ' + label)
  const box = el.getBoundingClientRect()
  const bounds = modal.getBoundingClientRect()
  if (box.left < bounds.left || box.right > bounds.right) failures.push('horizontal overflow: ' + label)
  const style = getComputedStyle(el)
  if (!style.outlineWidth || (style.outlineStyle === 'none' && style.boxShadow === 'none')) failures.push('no focus paint: ' + label)
  const reach = Math.max(shadowReach(style.boxShadow), style.outlineStyle === 'none' ? 0 : parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset || '0'))
  for (let ancestor = el.parentElement; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
    const css = getComputedStyle(ancestor), b = ancestor.getBoundingClientRect()
    if (css.overflowX !== 'visible' && Math.max(b.left + ancestor.clientLeft - (box.left - reach), box.right + reach - (b.left + ancestor.clientLeft + ancestor.clientWidth)) > .5) failures.push('clipped horizontal ring: ' + label)
  }
}
for (const thumbnail of root.querySelectorAll('.abele-image-thumbnail')) {
  const b = thumbnail.getBoundingClientRect(), expected = parseFloat(getComputedStyle(thumbnail).getPropertyValue('--size-4-16'))
  if (Math.abs(b.width - expected) > .5 || Math.abs(b.height - expected) > .5) failures.push('unstable thumbnail box')
}
const close = [...modal.querySelectorAll('button')].find(el => el.textContent.trim() === 'Close')
if (close) { close.focus(); close.scrollIntoView({block:'nearest'}); const b=close.getBoundingClientRect(); if(b.bottom>innerHeight||b.top<0) failures.push('unreachable close') }
const body = root.closest('.abele-modal__body') || root.parentElement
body.scrollTop = 0
return { failures, actions: intended.filter(el => el.getBoundingClientRect().width > 0).length, primary: modal.querySelectorAll('.mod-cta').length, height: modal.getBoundingClientRect().height }
`
