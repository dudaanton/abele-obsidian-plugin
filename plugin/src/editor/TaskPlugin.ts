import { StateField, RangeSetBuilder, EditorState } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView } from '@codemirror/view'
import { editorLivePreviewField, editorInfoField } from 'obsidian'
import { TaskWidget } from './TaskWidget'
import { rangesOverlap } from '@/helpers/editorHelpers'
import { parseTaskLine } from '@/helpers/tasksUtils'
// import { TaskHeaderWidget } from './TaskHeaderWidget'
import { FooterWidget } from './FooterWidget'
// import { HeaderWidget } from './HeaderWidget'

function buildTaskDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()

  if (!state.field(editorLivePreviewField)) {
    return builder.finish()
  }

  const currentFile = state.field(editorInfoField)?.file
  if (!currentFile) {
    return builder.finish()
  }

  // let frontmatterStartLine: number | null = null

  // const noteType = (state.field(editorInfoField) as any)?.metadataEditor?.properties?.find(
  //   (p: { key: string }) => p.key === 'type'
  // )?.value

  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)

    // if (line.text.trim() === '---' && frontmatterStartLine === null) {
    //   frontmatterStartLine = i
    //
    //   // add widget at the start of the frontmatter
    //   if (noteType === 'task') {
    //     builder.add(
    //       state.doc.line(frontmatterStartLine).from,
    //       state.doc.line(frontmatterStartLine).from,
    //       Decoration.widget({
    //         widget: new TaskHeaderWidget(currentFile.path),
    //         block: true,
    //         side: -1,
    //       })
    //     )
    //   } else {
    //     builder.add(
    //       state.doc.line(frontmatterStartLine).from,
    //       state.doc.line(frontmatterStartLine).from,
    //       Decoration.widget({
    //         widget: new HeaderWidget(currentFile.path),
    //         block: true,
    //         side: -1,
    //       })
    //     )
    //   }
    // }

    const wikilink = parseTaskLine(line.text)
    if (wikilink) {
      if (
        !state.selection.ranges.some((range) => {
          return rangesOverlap(range.from, range.to, line.from, line.to)
        })
      ) {
        builder.add(
          line.from,
          line.from + line.text.length,
          Decoration.replace({
            widget: new TaskWidget(currentFile.path, wikilink),
            block: true,
            inclusive: true, // without this option task is rendered with two lines around
          })
        )
      }
    }
  }

  const lastLine = state.doc.line(state.doc.lines)

  // if (!frontmatterStartLine) {
  //   builder.add(
  //     0,
  //     0,
  //     Decoration.widget({
  //       widget: new HeaderWidget(currentFile.path),
  //       block: true,
  //       side: -1,
  //     })
  //   )
  // }

  builder.add(
    lastLine.to,
    lastLine.to,
    Decoration.widget({
      widget: new FooterWidget(currentFile.path),
      block: true,
      side: 1,
    })
  )

  return builder.finish()
}

export const taskStateField = StateField.define<DecorationSet>({
  create(state) {
    return buildTaskDecorations(state)
  },
  update(decorations, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.state.field(editorLivePreviewField) !== tr.startState.field(editorLivePreviewField)
    ) {
      return buildTaskDecorations(tr.state)
    }

    return decorations.map(tr.changes)
  },
  provide(field) {
    return [EditorView.decorations.from(field)]
  },
})
