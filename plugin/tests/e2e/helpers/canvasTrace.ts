/**
 * In-page trace of the canvas editor's text and write path, for e2e files that drive card text
 * by real input. A wait that times out prints the trace and the editor's state, so a failure on a
 * device says why the text was not written instead of only "never true".
 *
 * Both bodies run inside the test's own prelude, where `view()` returns the canvas view.
 */
export const CANVAS_TRACE_INSTALL = `
  const editor = view()?.editor
  if (!editor) return false
  const trace = (window.__abeleCanvasTrace ??= [])
  const state = () => {
    const document = view()?.documentLease?.document, session = document?.session
    return {
      editing: editor.editing, composing: editor.composing, waiting: editor.waiting,
      textTimer: editor.textTimer !== null, failing: editor.writeFailing,
      dirty: session?.dirty, active: !!session?.draft?.active, steps: session?.pendingSteps,
      writing: session?.writing, conflict: session?.conflict, native: document?.state.native,
      draftPath: document?.draftPath === document?.file.path,
      focused: globalThis.document.activeElement?.getAttribute('aria-label') ?? globalThis.document.activeElement?.tagName,
    }
  }
  const note = (event, extra) => {
    trace.push({ t: Date.now() % 100000, event, ...extra, ...state() })
    if (trace.length > 80) trace.shift()
  }
  if (!editor.__abeleTraced) {
    editor.__abeleTraced = true
    const ports = editor.writes.ports
    const pending = ports.pending, write = ports.write, failed = ports.failed
    ports.pending = (d) => { const value = pending(d); note('pending', { value }); return value }
    ports.write = (d) => { note('write'); return Promise.resolve(write(d)).then(
      (v) => { note('written'); return v }, (e) => { note('write threw', { error: String(e) }); throw e }) }
    ports.failed = (d, e) => { note('failed', { error: String(e) }); return failed(d, e) }
    for (const type of ['focus', 'blur', 'input', 'compositionstart', 'compositionend'])
      editor.text.addEventListener(type, () => note(type, { value: editor.text.value }))
    window.addEventListener('blur', () => note('window blur'))
    globalThis.document.addEventListener('visibilitychange', () => note('visibility ' + globalThis.document.visibilityState))
  }
  note('installed')
  return true
`
export const CANVAS_TRACE_DUMP = `
  const editor = view()?.editor
  return { trace: window.__abeleCanvasTrace ?? [], focused: document.activeElement?.outerHTML?.slice(0, 120),
    status: view()?.viewer?.status?.textContent, editorStatus: editor?.status?.textContent }
`
