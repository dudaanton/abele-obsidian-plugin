import { EditorSelection, Prec, StateField, RangeSetBuilder, EditorState } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView, keymap } from '@codemirror/view'
import { editorLivePreviewField, editorInfoField } from 'obsidian'
import { GalleryWidget } from './GalleryWidget'
import { parseGalleryHeader, parseImageLine, GalleryImageEntry } from '@/helpers/galleryUtils'
import { rangesOverlap } from '@/helpers/editorHelpers'

interface GalleryBlock {
  headerFrom: number
  headerTo: number
  blockTo: number
  images: GalleryImageEntry[]
  layout: string
}

function findGalleryBlocks(state: EditorState): GalleryBlock[] {
  const blocks: GalleryBlock[] = []

  let i = 1
  while (i <= state.doc.lines) {
    const line = state.doc.line(i)
    const header = parseGalleryHeader(line.text)

    if (!header) {
      i++
      continue
    }

    const images: GalleryImageEntry[] = []
    let endLine = i
    let j = i + 1

    while (j <= state.doc.lines) {
      const nextLine = state.doc.line(j)
      const trimmed = nextLine.text.trim()

      if (trimmed === '') {
        j++
        continue
      }

      const image = parseImageLine(trimmed)
      if (image) {
        images.push(image)
        endLine = j
        j++
      } else {
        break
      }
    }

    blocks.push({
      headerFrom: line.from,
      headerTo: line.to,
      blockTo: state.doc.line(endLine).to,
      images,
      layout: header.layout,
    })

    i = endLine + 1
  }

  return blocks
}

function buildGalleryDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()

  if (!state.field(editorLivePreviewField)) {
    return builder.finish()
  }

  const currentFile = state.field(editorInfoField)?.file
  if (!currentFile) {
    return builder.finish()
  }

  const blocks = findGalleryBlocks(state)

  const hiddenLine = Decoration.line({ class: 'abele-gallery-hidden-line' })

  for (const block of blocks) {
    const headerLineNum = state.doc.lineAt(block.headerFrom).number
    const blockEndLineNum = state.doc.lineAt(block.blockTo).number

    const cursorOnHeader =
      block.images.length > 0 &&
      state.selection.ranges.some(
        (range) =>
          range.from === range.to &&
          rangesOverlap(range.from, range.to, block.headerFrom, block.headerTo)
      )

    if (cursorOnHeader) {
      // Focused: header as raw text, images as widget below
      builder.add(
        block.headerTo,
        block.blockTo,
        Decoration.replace({
          widget: new GalleryWidget(currentFile.path, block.images, block.layout),
          block: true,
          inclusive: true,
        })
      )
      for (let ln = headerLineNum + 1; ln <= blockEndLineNum; ln++) {
        builder.add(state.doc.line(ln).from, state.doc.line(ln).from, hiddenLine)
      }
    } else {
      // Normal: entire block as one widget
      builder.add(
        block.headerFrom,
        block.blockTo,
        Decoration.replace({
          widget: new GalleryWidget(currentFile.path, block.images, block.layout),
          block: true,
          inclusive: true,
        })
      )
      for (let ln = headerLineNum; ln <= blockEndLineNum; ln++) {
        builder.add(state.doc.line(ln).from, state.doc.line(ln).from, hiddenLine)
      }
    }
  }

  return builder.finish()
}

/**
 * Transaction filter: intercepts ANY cursor movement onto image lines
 * and redirects BEFORE the transaction is applied.
 * Uses line numbers (not just offsets) for robust detection.
 * Redirect target depends on where the cursor came from:
 * - from above or below → header end
 * - from header → past block
 */
const galleryCursorFilter = EditorState.transactionFilter.of((tr) => {
  if (tr.newSelection.eq(tr.startState.selection)) return tr

  if (!tr.startState.field(editorLivePreviewField, false)) return tr

  const doc = tr.startState.doc
  const blocks = findGalleryBlocks(tr.startState)
  if (blocks.length === 0) return tr

  const oldHead = tr.startState.selection.main.head
  const sel = tr.newSelection
  let modified = false

  const ranges = sel.ranges.map((range) => {
    for (const block of blocks) {
      if (block.images.length === 0) continue

      // Check if new cursor is inside the block but NOT on the header line
      if (range.head < block.headerFrom || range.head > block.blockTo) continue

      const newLine = doc.lineAt(range.head).number
      const headerLine = doc.lineAt(block.headerFrom).number
      if (newLine === headerLine) continue

      // Head landed on a non-header line within the block → redirect
      modified = true

      let newHead: number
      if (oldHead >= block.headerFrom && oldHead <= block.headerTo) {
        // Came from the header → skip past block
        const blockEndLine = doc.lineAt(block.blockTo)
        if (blockEndLine.number < doc.lines) {
          newHead = doc.line(blockEndLine.number + 1).from
        } else {
          newHead = block.headerTo
        }
      } else {
        // Came from above, below, or anywhere else → go to header end
        newHead = block.headerTo
      }

      // Preserve selection (anchor) if it exists
      if (range.anchor === range.head) {
        return EditorSelection.cursor(newHead)
      }
      return EditorSelection.range(range.anchor, newHead)
    }
    return range
  })

  if (modified) {
    return [tr, { selection: EditorSelection.create(ranges) }]
  }

  return tr
})

export const galleryStateField = StateField.define<DecorationSet>({
  create(state) {
    return buildGalleryDecorations(state)
  },
  update(decorations, tr) {
    if (
      tr.docChanged ||
      tr.state.field(editorLivePreviewField) !== tr.startState.field(editorLivePreviewField)
    ) {
      return buildGalleryDecorations(tr.state)
    }

    // Rebuild on keyboard/programmatic selection changes, but NOT on pointer clicks.
    // This prevents focused mode from activating when clicking gallery header icons.
    if (tr.selection && !tr.isUserEvent('select.pointer')) {
      return buildGalleryDecorations(tr.state)
    }

    return decorations.map(tr.changes)
  },
  provide(field) {
    return [EditorView.decorations.from(field)]
  },
})

/**
 * Keymap: Enter on the header line inserts a newline AFTER the block,
 * not between the header and the images.
 */
const galleryKeymap = Prec.high(
  keymap.of([
    {
      key: 'Enter',
      run: (view) => {
        const state = view.state
        const pos = state.selection.main.head

        if (!state.field(editorLivePreviewField, false)) return false

        const blocks = findGalleryBlocks(state)
        for (const block of blocks) {
          if (block.images.length === 0) continue
          if (pos >= block.headerFrom && pos <= block.headerTo) {
            if (pos === block.headerFrom) {
              // Cursor at the very start → insert line BEFORE the block
              view.dispatch({
                changes: { from: block.headerFrom, insert: '\n' },
                selection: { anchor: block.headerFrom },
              })
            } else {
              // Cursor elsewhere on header → insert line AFTER the block
              view.dispatch({
                changes: { from: block.blockTo, insert: '\n' },
                selection: { anchor: block.blockTo + 1 },
              })
            }
            return true
          }
        }
        return false
      },
    },
  ])
)

export const galleryExtensions = [galleryStateField, galleryCursorFilter, galleryKeymap]
