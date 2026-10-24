import { StateEffect, StateField, RangeSetBuilder, EditorState } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { editorLivePreviewField, editorInfoField } from 'obsidian'
import { TaskWidget } from './TaskWidget'
import { isNestedEditor, rangesOverlap } from '@/helpers/editorHelpers'
import { parseTaskLine } from '@/helpers/tasksUtils'
import { taskLinkOnLine, taskLinkPath } from '@/helpers/taskLinkDecision'
import { GlobalStore } from '@/stores/GlobalStore'
// import { TaskHeaderWidget } from './TaskHeaderWidget'
import { FooterWidget } from './FooterWidget'
export const refreshTaskTarget = StateEffect.define<string>()
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

    const wikilink = taskLinkOnLine(
      line.text,
      currentFile.path,
      GlobalStore.getInstance().app?.metadataCache
    )
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

  // A table cell's editor carries the note's file too; the footer belongs to the note alone.
  if (isNestedEditor(state)) {
    return builder.finish()
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
      widget: new FooterWidget(currentFile),
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

    const paths = tr.effects
      .filter((effect) => effect.is(refreshTaskTarget))
      .map((effect) => effect.value)
    if (paths.length && tr.state.field(editorLivePreviewField)) {
      const file = tr.state.field(editorInfoField)?.file
      if (!file) return decorations
      const cache = GlobalStore.getInstance().app?.metadataCache
      if (!cache) return decorations
      // Only matching checklist lines are resolved. Keep every unrelated decoration intact,
      // including the footer, and let CodeMirror redraw just the changed ranges.
      for (let i = 1; i <= tr.state.doc.lines; i++) {
        const line = tr.state.doc.line(i)
        const link = parseTaskLine(line.text)
        if (
          !link ||
          !paths.includes(cache.getFirstLinkpathDest(taskLinkPath(link), file.path)?.path)
        )
          continue
        const wikilink = taskLinkOnLine(line.text, file.path, cache)
        const selected = tr.state.selection.ranges.some((range) =>
          rangesOverlap(range.from, range.to, line.from, line.to)
        )
        decorations = decorations.update({
          filter: (from, to) => from !== line.from || to !== line.to,
          add:
            wikilink && !selected
              ? [
                  Decoration.replace({
                    widget: new TaskWidget(file.path, wikilink),
                    block: true,
                    inclusive: true,
                  }).range(line.from, line.to),
                ]
              : [],
          sort: true,
        })
      }
      return decorations
    }

    return decorations.map(tr.changes)
  },
  provide(field) {
    return [EditorView.decorations.from(field)]
  },
})

/** Each editor owns its listener, including embedded editors, and releases it on close. */
export const taskMetadataExtension = ViewPlugin.fromClass(
  class {
    private readonly cache = GlobalStore.getInstance().app?.metadataCache
    private readonly event
    private links: string[] = []
    private index(state: EditorState) {
      this.links = []
      for (let i = 1; i <= state.doc.lines; i++) {
        const link = parseTaskLine(state.doc.line(i).text)
        if (link) this.links.push(taskLinkPath(link))
      }
    }
    constructor(view: EditorView) {
      this.index(view.state)
      this.event = this.cache?.on('changed', (file) => {
        const source = view.state.field(editorInfoField, false)?.file?.path
        if (
          source &&
          view.state.field(editorLivePreviewField, false) &&
          this.links.some(
            (link) => this.cache?.getFirstLinkpathDest(link, source)?.path === file.path
          )
        )
          view.dispatch({ effects: refreshTaskTarget.of(file.path) })
      })
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.index(update.state)
    }
    destroy() {
      if (this.event) this.cache?.offref(this.event)
    }
  }
)
