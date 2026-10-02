export interface FitIssue {
  kind: 'overflow' | 'clipped-media' | 'cropped-media' | 'missing-media' | 'crowded'
  message: string
  region?: number
  width?: number
  height?: number
}
export interface SlideFit {
  issues: FitIssue[]
  /** Density is a warning, not a proof of visual quality. */
  textCharacters: number
  textBlocks: number
}

/** Measures the mounted logical canvas, not the viewport's phone-scaled dimensions.
 * Speaker notes never enter this DOM. Live frames/scripts need separate inspection. */
export function checkSlideFit(slide: HTMLElement): SlideFit {
  const issues: FitIssue[] = []
  if (slide.dataset.missingBackground)
    issues.push({
      kind: 'missing-media',
      message: `Background could not be resolved: ${slide.dataset.missingBackground}`,
    })
  const regions = Array.from(slide.querySelectorAll<HTMLElement>('.abele-slide-region'))
  const win = slide.ownerDocument.defaultView!
  const scale =
    slide.clientWidth > 0 ? slide.getBoundingClientRect().width / slide.clientWidth || 1 : 1
  const bounds = slide.getBoundingClientRect()
  for (const [index, region] of regions.entries()) {
    const box = region.getBoundingClientRect()
    const width = Math.max(
      0,
      region.scrollWidth - region.clientWidth,
      (bounds.left - box.left) / scale,
      (box.right - bounds.right) / scale
    )
    const height = Math.max(
      0,
      region.scrollHeight - region.clientHeight,
      (bounds.top - box.top) / scale,
      (box.bottom - bounds.bottom) / scale
    )
    if (width > 2 || height > 2)
      issues.push({
        kind: 'overflow',
        region: index + 1,
        width,
        height,
        message: `Region ${index + 1} overflows by ${width}×${height} logical pixels`,
      })
  }
  for (const element of Array.from(
    slide.querySelectorAll<HTMLElement>('p, li, pre, table, h1, h2, h3, h4, h5, h6')
  )) {
    const width = element.clientWidth ? Math.max(0, element.scrollWidth - element.clientWidth) : 0
    const height = element.clientHeight
      ? Math.max(0, element.scrollHeight - element.clientHeight)
      : 0
    if (width > 2 || height > 2)
      issues.push({
        kind: 'overflow',
        width,
        height,
        message: `A text block overflows by ${width}×${height} logical pixels`,
      })
  }
  for (const media of Array.from(
    slide.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video')
  )) {
    const region = media.closest<HTMLElement>('.abele-slide-region')
    const box = media.getBoundingClientRect()
    const clip =
      region && win.getComputedStyle(region).overflow !== 'visible'
        ? region.getBoundingClientRect()
        : bounds
    if (
      box.left < clip.left - 2 * scale ||
      box.top < clip.top - 2 * scale ||
      box.right > clip.right + 2 * scale ||
      box.bottom > clip.bottom + 2 * scale
    )
      issues.push({
        kind: 'clipped-media',
        message: 'An image/video extends outside its clipping region',
      })
    const naturalWidth = 'naturalWidth' in media ? media.naturalWidth : media.videoWidth
    const naturalHeight = 'naturalHeight' in media ? media.naturalHeight : media.videoHeight
    if ('naturalWidth' in media && !naturalWidth)
      issues.push({
        kind: 'missing-media',
        message: `Image has not loaded: ${media.getAttribute('src') ?? '(no source)'}`,
      })
    if (!('naturalWidth' in media) && (media.error || media.readyState < 1 || !naturalWidth))
      issues.push({
        kind: 'missing-media',
        message: `Video ${media.error ? 'could not be loaded' : 'metadata has not loaded'}: ${media.getAttribute('src') ?? media.querySelector('source')?.getAttribute('src') ?? '(no source)'}`,
      })
    if (
      naturalWidth &&
      naturalHeight &&
      box.height &&
      win.getComputedStyle(media).objectFit === 'cover' &&
      Math.abs(naturalWidth / naturalHeight - box.width / box.height) > 0.05
    )
      issues.push({
        kind: 'cropped-media',
        message: 'Cover-fit crops an image/video intentionally; inspect its framing in the picture',
      })
  }
  const textCharacters = regions.reduce((n, r) => n + (r.textContent ?? '').trim().length, 0)
  const textBlocks = slide.querySelectorAll('p, li, pre, tr').length
  if (textCharacters > 1200 || textBlocks > 12)
    issues.push({
      kind: 'crowded',
      message: `${textCharacters} text characters and ${textBlocks} text blocks; consider splitting this slide (density heuristic)`,
    })
  return { issues, textCharacters, textBlocks }
}
