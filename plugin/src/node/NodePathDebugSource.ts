import { EditorView } from '@codemirror/view'
import {
  mountDebugSource,
  registerDebugSourceRevealer,
  type DebugSourceContext,
} from '@/debugger/sourceExtension'

/** A file leaf admits an explicit source/build mapping; filenames never become source IDs. */
export function mountNodePathDebugSource(
  host: HTMLElement,
  context: DebugSourceContext,
  show: (line: number) => void,
  selection?: Parameters<typeof mountDebugSource>[2]
) {
  const captured = Object.freeze({ ...context })
  const extension = selection
    ? mountDebugSource(host, captured, selection)
    : mountDebugSource(host, captured)
  const reveal = (line: number) => {
    extension.reveal(line)
    queueMicrotask(() => {
      const element = host.querySelector<HTMLElement>('.cm-editor')
      const editor = element && EditorView.findFromDOM(element)
      if (editor) {
        const selected = editor.state.doc.line(Math.max(1, Math.min(line, editor.state.doc.lines)))
        editor.dispatch({ effects: EditorView.scrollIntoView(selected.from, { y: 'center' }) })
      }
    })
  }
  const stop = registerDebugSourceRevealer((request) => {
    if (
      request.registrationId !== captured.registrationId ||
      request.conversationId !== captured.conversationId ||
      request.sourceId !== captured.sourceId ||
      request.path !== captured.path
    )
      return false
    console.debug('[debugger] Source reveal handler', captured.path, request.line)
    reveal(request.line)
    show(request.line)
    return true
  })
  return {
    reveal,
    update: (text: string) => extension.update(text),
    destroy: () => {
      stop()
      extension.destroy()
    },
  }
}
