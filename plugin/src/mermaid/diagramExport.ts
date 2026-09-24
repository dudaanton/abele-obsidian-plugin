/**
 * A diagram taken out of the note: as SVG text, or as a PNG picture.
 *
 * What is on screen leans on the page around it — Obsidian's font through a CSS variable, the
 * theme's background behind a transparent drawing. A copy has neither, so both are written
 * into it here.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The drawing as a standalone SVG file's text.
 *
 * @param fontFamily what `var(--font-mermaid)` resolves to on screen; a file opened anywhere
 *   else has no such variable and would fall back to a font the layout was not measured with.
 */
export function svgMarkup(svg: SVGSVGElement, fontFamily = ''): string {
  const copy = svg.cloneNode(true) as SVGSVGElement
  copy.setAttribute('xmlns', SVG_NS)
  let markup = new XMLSerializer().serializeToString(copy)
  // Single quotes only: the value may land inside a double-quoted attribute.
  if (fontFamily) markup = markup.split('var(--font-mermaid)').join(fontFamily.replace(/"/g, "'"))
  return markup
}

/**
 * The drawing as a PNG, `scale` times its natural size, on `background`.
 *
 * The SVG is drawn through an image and a canvas, which is the one way a browser turns SVG into
 * pixels. A picture whose labels are HTML — most of Mermaid's — can make the canvas refuse to
 * give its pixels back; the caller is told by the rejected promise.
 */
export async function svgToPng(
  markup: string,
  size: { width: number; height: number },
  background: string,
  win: Window,
  scale = 2
): Promise<Blob> {
  const image = new (win as Window & { Image: typeof Image }).Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  await image.decode()

  const canvas = win.createEl('canvas')
  canvas.width = Math.ceil(size.width * scale)
  canvas.height = Math.ceil(size.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No canvas to draw on')
  if (background) {
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Empty picture'))),
      'image/png'
    )
  )
}
