import { genid } from '@/helpers/vueUtils'
import {
  GalleryImageEntry,
  parseGalleryHeader,
  parseImageLine,
  buildImageLine,
} from '@/helpers/galleryUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { getEditorForFile } from '@/helpers/vaultUtils'
import { TFile } from 'obsidian'

export class Gallery {
  public readonly id: string
  public readonly file: TFile
  public readonly images: GalleryImageEntry[]
  public readonly layout: string
  public readonly height: number
  public readonly bg: boolean

  /** Current file path (follows renames via TFile reference) */
  get filePath(): string {
    return this.file.path
  }

  constructor(data: {
    id?: string
    file: TFile
    images: GalleryImageEntry[]
    layout: string
    height: number
    bg: boolean
  }) {
    this.id = data.id || genid()
    this.file = data.file
    this.images = data.images
    this.height = data.height
    this.bg = data.bg
    this.layout = data.layout
    this.height = data.height
    this.bg = data.bg
  }

  resolveImageUrl(image: GalleryImageEntry, version = 0): string | null {
    if (image.type === 'remote') {
      return image.path
    }

    const { app } = GlobalStore.getInstance()
    const file = app.metadataCache.getFirstLinkpathDest(image.path, this.filePath)
    if (file) {
      const url = app.vault.getResourcePath(file)
      return version ? `${url}#v=${version}` : url
    }

    return null
  }

  private findBlockInText(lines: string[]): { headerLine: number; lastImageLine: number } | null {
    for (let i = 0; i < lines.length; i++) {
      if (!parseGalleryHeader(lines[i])) continue

      if (this.images.length === 0) {
        return { headerLine: i, lastImageLine: i }
      }

      let imageIdx = 0
      let lastImageLine = i
      for (let j = i + 1; j < lines.length && imageIdx < this.images.length; j++) {
        if (lines[j].trim() === '') continue
        const img = parseImageLine(lines[j])
        if (img && img.raw === this.images[imageIdx].raw) {
          imageIdx++
          lastImageLine = j
        } else {
          break
        }
      }

      if (imageIdx === this.images.length) {
        return { headerLine: i, lastImageLine }
      }
    }
    return null
  }

  /** Collect actual line numbers for each image (skipping empty lines) */
  private getImageLineNumbers(
    lines: string[],
    block: { headerLine: number; lastImageLine: number }
  ): number[] {
    const lineNums: number[] = []
    for (let j = block.headerLine + 1; j <= block.lastImageLine; j++) {
      if (lines[j].trim() === '' || !parseImageLine(lines[j])) continue
      lineNums.push(j)
    }
    return lineNums
  }

  addImage(imagePath: string) {
    const editor = getEditorForFile(this.filePath)
    if (!editor) return

    const lines = editor.getValue().split('\n')
    const block = this.findBlockInText(lines)
    if (!block) return

    const insertLine = block.lastImageLine
    const insertCh = lines[insertLine].length
    editor.replaceRange('\n' + `![[${imagePath}]]`, { line: insertLine, ch: insertCh })
  }

  addImages(paths: string[]) {
    const editor = getEditorForFile(this.filePath)
    if (!editor) return

    const lines = editor.getValue().split('\n')
    const block = this.findBlockInText(lines)
    if (!block) return

    const insertLine = block.lastImageLine
    const insertCh = lines[insertLine].length
    const newLines = paths.map((p) => `![[${p}]]`).join('\n')
    editor.replaceRange('\n' + newLines, { line: insertLine, ch: insertCh })
  }

  removeImage(index: number) {
    const editor = getEditorForFile(this.filePath)
    if (!editor) return

    const lines = editor.getValue().split('\n')
    const block = this.findBlockInText(lines)
    if (!block) return

    const imageLines = this.getImageLineNumbers(lines, block)
    if (index < 0 || index >= imageLines.length) return

    const lineNum = imageLines[index]
    const from = { line: lineNum - 1, ch: lines[lineNum - 1].length }
    const to = { line: lineNum, ch: lines[lineNum].length }
    editor.replaceRange('', from, to)
  }

  updateDescription(index: number, description: string) {
    const editor = getEditorForFile(this.filePath)
    if (!editor) return

    const lines = editor.getValue().split('\n')
    const block = this.findBlockInText(lines)
    if (!block) return

    const imageLines = this.getImageLineNumbers(lines, block)
    if (index < 0 || index >= imageLines.length) return

    const lineNum = imageLines[index]
    const entry = parseImageLine(lines[lineNum])
    if (!entry) return

    entry.description = description
    const newLine = buildImageLine(entry)
    const from = { line: lineNum, ch: 0 }
    const to = { line: lineNum, ch: lines[lineNum].length }
    editor.replaceRange(newLine, from, to)
  }

  moveImage(index: number, direction: -1 | 1) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= this.images.length) return

    const editor = getEditorForFile(this.filePath)
    if (!editor) return

    const lines = editor.getValue().split('\n')
    const block = this.findBlockInText(lines)
    if (!block) return

    const imageLines = this.getImageLineNumbers(lines, block)
    if (index < 0 || index >= imageLines.length) return
    if (targetIndex < 0 || targetIndex >= imageLines.length) return

    const lineA = imageLines[index]
    const lineB = imageLines[targetIndex]

    // Swap the two lines
    const tmp = lines[lineA]
    lines[lineA] = lines[lineB]
    lines[lineB] = tmp
    editor.setValue(lines.join('\n'))
  }

  private buildHeader(layout: string, height: number, bg: boolean): string {
    const opts: string[] = []
    if (layout !== 'grid') opts.push(`layout=${layout}`)
    if (height !== 400) opts.push(`height=${height}`)
    if (!bg) opts.push('bg=false')
    return opts.length > 0 ? `::abele-gallery{${opts.join(',')}}::` : '::abele-gallery::'
  }

  setLayout(newLayout: string) {
    this.updateHeader(newLayout, this.height, this.bg)
  }

  setHeight(newHeight: number) {
    this.updateHeader(this.layout, newHeight, this.bg)
  }

  setBg(newBg: boolean) {
    this.updateHeader(this.layout, this.height, newBg)
  }

  private updateHeader(layout: string, height: number, bg: boolean) {
    const editor = getEditorForFile(this.filePath)
    if (!editor) return

    const lines = editor.getValue().split('\n')
    const block = this.findBlockInText(lines)
    if (!block) return

    const from = { line: block.headerLine, ch: 0 }
    const to = { line: block.headerLine, ch: lines[block.headerLine].length }
    editor.replaceRange(this.buildHeader(layout, height, bg), from, to)
  }

  /** Remove only the ::abele-gallery:: header, leaving image links as plain markdown */
  removeHeaderOnly() {
    const editor = getEditorForFile(this.filePath)
    if (!editor) return

    const lines = editor.getValue().split('\n')
    const block = this.findBlockInText(lines)
    if (!block) return

    // Delete header line (and its trailing newline if images follow)
    if (block.headerLine < block.lastImageLine) {
      const from = { line: block.headerLine, ch: 0 }
      const to = { line: block.headerLine + 1, ch: 0 }
      editor.replaceRange('', from, to)
    } else {
      // No images — just delete the header line
      const fromLine = block.headerLine > 0 ? block.headerLine - 1 : 0
      const fromCh = block.headerLine > 0 ? lines[block.headerLine - 1].length : 0
      const to = { line: block.headerLine, ch: lines[block.headerLine].length }
      editor.replaceRange('', { line: fromLine, ch: fromCh }, to)
    }
  }

  /** Remove the entire block — header and all image links */
  removeBlock() {
    const editor = getEditorForFile(this.filePath)
    if (!editor) return

    const lines = editor.getValue().split('\n')
    const block = this.findBlockInText(lines)
    if (!block) return

    const from = { line: block.headerLine, ch: 0 }
    const toLine =
      block.lastImageLine + 1 < lines.length ? block.lastImageLine + 1 : block.lastImageLine
    const toCh = block.lastImageLine + 1 < lines.length ? 0 : lines[block.lastImageLine].length
    // Also remove preceding newline if header is not on line 0
    const fromLine = block.headerLine > 0 ? block.headerLine - 1 : 0
    const fromCh = block.headerLine > 0 ? lines[block.headerLine - 1].length : 0
    editor.replaceRange('', { line: fromLine, ch: fromCh }, { line: toLine, ch: toCh })
  }

  cleanup() {
    // nothing to clean up for now
  }
}
