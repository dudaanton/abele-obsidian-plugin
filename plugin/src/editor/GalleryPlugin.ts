import { StateField, RangeSetBuilder, EditorState } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView } from '@codemirror/view'
import { editorLivePreviewField, editorInfoField } from 'obsidian'
import { GalleryWidget } from './GalleryWidget'
import { parseGalleryHeader, parseImageLine, GalleryImageEntry } from '@/helpers/galleryUtils'
import { rangesOverlap } from '@/helpers/editorHelpers'

function buildGalleryDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()

  if (!state.field(editorLivePreviewField)) {
    return builder.finish()
  }

  const currentFile = state.field(editorInfoField)?.file
  if (!currentFile) {
    return builder.finish()
  }

  let i = 1
  while (i <= state.doc.lines) {
    const line = state.doc.line(i)
    const header = parseGalleryHeader(line.text)

    if (!header) {
      i++
      continue
    }

    // Found gallery header — collect image lines
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

    const blockFrom = line.from
    const blockTo = state.doc.line(endLine).to

    // Don't replace when cursor is inside the gallery block
    const cursorInBlock = state.selection.ranges.some((range) =>
      rangesOverlap(range.from, range.to, blockFrom, blockTo)
    )

    if (!cursorInBlock) {
      builder.add(
        blockFrom,
        blockTo,
        Decoration.replace({
          widget: new GalleryWidget(currentFile.path, images, header.layout),
          block: true,
          inclusive: true,
        })
      )
    }

    i = endLine + 1
  }

  return builder.finish()
}

export const galleryStateField = StateField.define<DecorationSet>({
  create(state) {
    return buildGalleryDecorations(state)
  },
  update(decorations, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.state.field(editorLivePreviewField) !== tr.startState.field(editorLivePreviewField)
    ) {
      return buildGalleryDecorations(tr.state)
    }

    return decorations.map(tr.changes)
  },
  provide(field) {
    return [EditorView.decorations.from(field)]
  },
})
