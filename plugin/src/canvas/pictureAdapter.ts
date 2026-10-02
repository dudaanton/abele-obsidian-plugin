import { TFile, type App } from 'obsidian'
import { stepScene } from './core/steps'
import { lintCanvas } from './core/lint'
import { rasterScale } from '../drawing/rasterize'
import { vaultUrl } from '../helpers/vaultUrl'
import {
  canvasMetrics,
  paintCanvas,
  pictureRegion,
  textResolutionWarnings,
  type CanvasTheme,
  type ImageAsset,
} from './core/painter'
import { defaultMetrics, type TextMetricsPort } from './core/scene'
import {
  descendants,
  overlaps,
  parentsOf,
  labelOf,
  type CanvasGraph,
  type Rect,
} from './core/model'

export function canvasTheme(doc: Document): CanvasTheme {
  const css = doc.defaultView.getComputedStyle(doc.body)
  const value = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    paper: value('--background-primary', css.backgroundColor),
    card: value('--background-primary', css.backgroundColor),
    text: value('--text-normal', css.color),
    border: value('--background-modifier-border', css.color),
    accent: value('--interactive-accent', css.color),
    muted: value('--text-muted', css.color),
    font: value('--font-text', css.fontFamily),
    size: parseFloat(value('--font-text-size', css.fontSize)) || 16,
    lineHeight: parseFloat(value('--line-height-normal', '')) || 1.4,
    presets: ['red', 'orange', 'yellow', 'green', 'cyan', 'purple'].map((color) =>
      value(`--color-${color}`, css.color)
    ),
  }
}
export function hostMetrics(): TextMetricsPort {
  const doc = typeof activeDocument === 'undefined' ? document : activeDocument
  const canvas = doc.win.createEl('canvas'),
    ctx = canvas.getContext('2d')
  return ctx ? canvasMetrics(ctx, canvasTheme(doc)) : defaultMetrics
}
export function notePart(text: string, subpath?: string): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')
  if (!subpath) return clean
  const heading = subpath.replace(/^#/, '')
  if (heading.startsWith('^')) {
    const block = clean
      .split(/\n\s*\n/)
      .find((p) => p.trimEnd().endsWith(` ${heading}`) || p.trimEnd().endsWith(`\n${heading}`))
    return block
      ? block.trimEnd().slice(0, -heading.length).trimEnd()
      : `[Missing block ${heading}]`
  }
  const lines = clean.split('\n'),
    start = lines.findIndex(
      (line) => /^#+\s+/.test(line) && line.replace(/^#+\s+/, '').trim() === heading
    )
  if (start < 0) return `[Missing heading ${heading}]`
  const level = /^#+/.exec(lines[start])[0].length
  const end = lines.findIndex(
    (line, i) => i > start && /^#+\s+/.test(line) && /^#+/.exec(line)[0].length <= level
  )
  return lines.slice(start, end < 0 ? undefined : end).join('\n')
}
const IMAGE = /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i
export async function canvasAssets(
  app: App,
  graph: CanvasGraph,
  sourcePath: string,
  inScope: (path: string) => boolean,
  doc: Document,
  signal?: AbortSignal
) {
  const contents = new Map<string, string>(),
    images = new Map<string, ImageAsset[]>(),
    warnings: { code: string; ids: string[]; message: string }[] = []
  const load = async (node: string, path: string, relative: string): Promise<void> => {
    const file = app.metadataCache.getFirstLinkpathDest(path, relative)
    if (!(file instanceof TFile) || !IMAGE.test(file.extension) || !inScope(file.path)) {
      warnings.push({
        code: 'unavailable-image',
        ids: [node],
        message: `${node}: local image is missing or outside scope`,
      })
      return
    }
    signal?.throwIfAborted()
    try {
      const image = doc.win.createEl('img')
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          window.clearTimeout(timer)
          image.onload = null
          image.onerror = null
          signal?.removeEventListener('abort', abort)
          error ? reject(error) : resolve()
        }
        const abort = () => {
          image.src = ''
          finish(new Error('Image load aborted'))
        }
        const timer = window.setTimeout(() => finish(new Error('Local image did not load')), 8000)
        image.onload = () => finish()
        image.onerror = () => finish(new Error('Local image could not be drawn'))
        signal?.addEventListener('abort', abort, { once: true })
        image.src = vaultUrl(app, file)
      })
      const list = images.get(node) ?? []
      list.push({ source: image, width: image.naturalWidth, height: image.naturalHeight })
      images.set(node, list)
    } catch (error) {
      signal?.throwIfAborted()
      warnings.push({
        code: 'unavailable-image',
        ids: [node],
        message: `${node}: ${error instanceof Error ? error.message : 'image unavailable'}`,
      })
    }
  }
  for (const node of graph.nodes) {
    signal?.throwIfAborted()
    let text = labelOf(node),
      relative = sourcePath
    if (node.type === 'file' && node.file) {
      if (!inScope(node.file)) text = '[Note content outside scope]'
      else {
        const file = app.vault.getAbstractFileByPath(node.file)
        if (!(file instanceof TFile)) {
          text = '[Missing file]'
          warnings.push({
            code: 'missing-file',
            ids: [node.id],
            message: `${node.id}: linked file is missing`,
          })
        } else if (IMAGE.test(file.extension)) {
          text = ''
          await load(node.id, file.path, sourcePath)
        } else if (file.extension === 'md') {
          text = notePart(await app.vault.read(file), node.subpath)
          relative = file.path
        } else
          text = `${file.name}${file.extension === 'canvas' ? '\nSub-diagram (open for detail)' : ''}`
      }
    }
    contents.set(node.id, text)
    for (const match of text.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g))
      await load(node.id, match[1].split('#')[0], relative)
    for (const match of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      const path = match[1].replace(/^<|>$/g, '')
      if (!/^[a-z]+:/i.test(path)) {
        let decoded = path
        try {
          decoded = decodeURIComponent(path)
        } catch {
          /* A literal percent sign is valid in vault filenames. */
        }
        await load(node.id, decoded, relative)
      } else
        warnings.push({
          code: 'remote-image',
          ids: [node.id],
          message: `${node.id}: remote images are not fetched for a canvas picture`,
        })
    }
  }
  return { contents, images, warnings }
}
export async function canvasRegionAssets(
  app: App,
  graph: CanvasGraph,
  path: string,
  inScope: (path: string) => boolean,
  doc: Document,
  region: Rect,
  signal?: AbortSignal
) {
  const parents = parentsOf(graph)
  const hidden = new Set(
    graph.nodes
      .filter((n) => n.type === 'group' && n.collapsed)
      .flatMap((n) => descendants(n.id, parents))
  )
  const nodes = graph.nodes.filter((n) => !hidden.has(n.id) && overlaps(n, region))
  return canvasAssets(app, { ...graph, nodes }, path, inScope, doc, signal)
}

export async function canvasPicture(
  app: App,
  graph: CanvasGraph,
  path: string,
  options: { region?: Rect; node?: string; step?: number; maxSide?: number },
  inScope: (path: string) => boolean,
  signal?: AbortSignal
) {
  const doc = typeof activeDocument === 'undefined' ? document : activeDocument,
    region = pictureRegion(graph, options)
  const source = graph
  const playback = options.step === undefined ? null : stepScene(graph, options.step)
  if (playback) graph = playback.graph
  const canvas = doc.win.createEl('canvas'),
    ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  const maxSide = options.maxSide ?? 2048
  if (!Number.isFinite(maxSide) || maxSide < 64 || maxSide > 4096)
    throw new Error('maxSide must be between 64 and 4096')
  const scale = rasterScale(
    { x: region.x, y: region.y, w: region.width, h: region.height },
    { maxSide }
  )
  canvas.width = Math.max(1, Math.round(region.width * scale))
  canvas.height = Math.max(1, Math.round(region.height * scale))
  ctx.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale)
  const assets = await canvasRegionAssets(app, graph, path, inScope, doc, region, signal)
  signal?.throwIfAborted()
  const theme = canvasTheme(doc)
  const result = paintCanvas(ctx, graph, region, theme, {
    ...assets,
    highlight: playback?.highlight,
  })
  return {
    canvas,
    region,
    warnings: [
      ...result.warnings,
      ...assets.warnings,
      ...(playback
        ? lintCanvas(source).filter((w) =>
            ['invalid-step', 'missing-step-id', 'dense-step'].includes(w.code)
          )
        : []),
      ...textResolutionWarnings(scale, theme.size),
    ],
    visible: result.visible,
    say: playback?.say,
  }
}
