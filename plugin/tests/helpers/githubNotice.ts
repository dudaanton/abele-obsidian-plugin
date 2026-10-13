// A GitHub notice says its first sentence and folds the rest away; these read it whole and press
// its retry glyph, as a person who opens the fold and asks again would.
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'

type Found = VueWrapper | DOMWrapper<Element>

/** The notice's whole text, its fold opened first. */
export async function noticeText(at: Found, selector = '.abele-github-notice'): Promise<string> {
  const notice = at.find(selector)
  const fold = notice.find('.abele-disclosure__control')
  if (fold.exists() && fold.attributes('aria-expanded') !== 'true') await fold.trigger('click')
  return at.find(selector).text()
}

/** The glyph that asks again, inside the notice found by `selector`. */
export const retryOf = (at: Found, selector = '.abele-github-notice') =>
  at.find(`${selector} .abele-github-notice__retry`)
