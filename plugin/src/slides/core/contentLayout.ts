/** Separate a leading heading from a plain-text content body without re-rendering Markdown.
 * Tables, embeds, code and live controls keep their original top-aligned layout. */
export function prepareContentBody(slide: HTMLElement): HTMLElement | null {
  const content = slide.querySelector<HTMLElement>(':scope > .abele-slide-content')
  const regions = content?.querySelectorAll<HTMLElement>(':scope > .abele-slide-region')
  if (!content || regions?.length !== 1) return null
  const body = regions[0]
  if (!body.classList.contains('abele-slide-region-body')) return null
  if (body.classList.contains('abele-slide-content-body')) return body
  if (
    body.querySelector(
      'table, img, video, audio, pre, iframe, svg, canvas, input, .callout, .internal-embed'
    )
  )
    return null
  const block = body.firstElementChild
  if (!block) return null
  const heading = slide.ownerDocument.createElement('div')
  heading.className = 'abele-slide-content-heading'
  while (block.firstElementChild?.matches('h1, h2, h3, h4, h5, h6'))
    heading.append(block.firstElementChild)
  if (heading.childElementCount) content.prepend(heading)
  body.classList.add('abele-slide-content-body')
  return body
}

/** Use logical element heights, never the viewport's scaled phone dimensions. */
export function alignShortContentBody(slide: HTMLElement): void {
  const body = slide.querySelector<HTMLElement>('.abele-slide-content-body')
  if (!body) return
  const win = slide.ownerDocument.defaultView!
  const height = Array.from(body.children).reduce((total, child) => {
    const element = child as HTMLElement
    const style = win.getComputedStyle(element)
    return (
      total +
      element.offsetHeight +
      (parseFloat(style.marginTop) || 0) +
      (parseFloat(style.marginBottom) || 0)
    )
  }, 0)
  slide.classList.toggle(
    'abele-slide-short-body',
    !!body.textContent?.trim() &&
      height > 0 &&
      body.clientHeight > 0 &&
      height < body.clientHeight / 3
  )
}
