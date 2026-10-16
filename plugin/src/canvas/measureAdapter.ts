/** Real Markdown card measurements, independent of an open canvas or camera. */
import { Component, MarkdownRenderer, TFile, type App } from 'obsidian'
import { centredLabel, contentBox } from './core/scene'
import type { CanvasNode } from './core/model'
import { notePart } from './pictureAdapter'
import type { MeasureCard } from './core/authoring'

export async function renderedCard(
  app: App,
  node: CanvasNode,
  source: string,
  inScope: (path: string) => boolean,
  signal?: AbortSignal
): Promise<{ measure: MeasureCard; release(): void }> {
  let text = node.text ?? '',
    relative = source
  if (node.type === 'file') {
    if (!node.file || !inScope(node.file)) throw new Error('Linked card is outside scope')
    const file = app.vault.getAbstractFileByPath(node.file)
    if (!(file instanceof TFile) || file.extension !== 'md')
      throw new Error('Measure requires a text or Markdown card')
    text = notePart(await app.vault.cachedRead(file), node.subpath)
    relative = file.path
  } else if (node.type !== 'text') throw new Error('Measure requires a text or Markdown card')
  // Embedded content can read outside the requested canvas. Do not render it implicitly.
  if (/!\[|<\s*(img|iframe|video|audio|object|embed)\b/i.test(text))
    throw new Error(
      'Measure embedded media separately; embedded content is not loaded by measurement'
    )
  signal?.throwIfAborted()
  const doc = typeof activeDocument === 'undefined' ? document : activeDocument
  const host = doc.win.createDiv(),
    body = doc.win.createDiv(),
    component = new Component()
  host.className = 'abele-canvas-cards abele-canvas-measure'
  body.className = 'abele-canvas-card markdown-rendered'
  host.append(body)
  doc.body.append(host)
  component.load()
  const release = () => {
    component.unload()
    host.remove()
  }
  try {
    await MarkdownRenderer.render(app, text, body, relative, component)
    await doc.fonts?.ready
    signal?.throwIfAborted()
    return {
      release,
      measure: (candidate) => {
        signal?.throwIfAborted()
        body.toggleClass('abele-canvas-card_centred', centredLabel(candidate))
        if (
          candidate.text !== node.text ||
          candidate.file !== node.file ||
          candidate.subpath !== node.subpath
        )
          throw new Error('Card changed during measurement; read again')
        // Bisection includes shape-specific content insets, including pills whose width depends on height.
        const fits = (height: number) => {
          const box = contentBox({ ...candidate, height })
          body.style.width = `${box.width}px`
          const rect = body.getBoundingClientRect()
          const needed = Math.max(rect.height, body.scrollHeight)
          if (needed <= 0) throw new Error('Rendered layout is unavailable')
          return needed <= box.height && body.scrollWidth <= box.width + 1
        }
        let low = 1,
          high = 32768
        if (!fits(high)) throw new Error('Content cannot fit at this width; increase width')
        for (let i = 0; i < 16; i++) {
          const mid = (low + high) / 2
          if (fits(mid)) high = mid
          else low = mid
        }
        fits(Math.ceil(high))
        return {
          width: candidate.width,
          height: Math.ceil(high),
          contentWidth: body.scrollWidth,
          contentHeight: Math.max(body.scrollHeight, body.getBoundingClientRect().height),
        }
      },
    }
  } catch (error) {
    release()
    throw error
  }
}
