import { ensureSyntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { Menu, Notice, TFile, type Editor, type Plugin } from 'obsidian'
import { parseTaskLine } from '@/helpers/tasksUtils'
import { bindCheckboxMenu } from './gestures'
import { checkboxOnLine, changeCheckbox } from './markdown'
import { installCheckboxIcons } from './presentation'
import { CHECKBOX_STATES, nextCheckboxState, type CheckboxMarker } from './states'

interface Target {
  marker: CheckboxMarker
  set: (marker: CheckboxMarker) => void | Promise<void>
}

/** Do not turn examples in code, comments or YAML into actual checklist edits. */
function editorTarget(view: EditorView, number: number): Target | null {
  const line = view.state.doc.line(number)
  const box = checkboxOnLine(line.text)
  if (!box || parseTaskLine(line.text)) return null
  const tree = ensureSyntaxTree(view.state, line.to, 50)
  if (!tree) return null
  for (let node = tree.resolveInner(line.from + box.from, 1); node; node = node.parent!) {
    if (/code|frontmatter|comment/i.test(node.name)) return null
  }
  const original = line.text
  return {
    marker: box.state.marker,
    set(marker) {
      // A menu is a snapshot. Never edit another item after the document moved under it.
      if (number > view.state.doc.lines || view.state.doc.line(number).text !== original) {
        new Notice('The checklist changed. Open its state menu again.')
        return
      }
      const at = view.state.doc.line(number).from + box.from
      view.dispatch({ changes: { from: at, to: at + 1, insert: marker }, userEvent: 'input' })
    },
  }
}

/** Guarded replacement used by reading view, preserving the rest of the file byte for byte. */
export function replaceCheckboxLine(
  text: string,
  line: number,
  expected: string,
  marker: CheckboxMarker
): string {
  const lines = text.split('\n')
  if (lines[line] !== expected) throw new Error('The checklist changed. Open its state menu again.')
  lines[line] = changeCheckbox(lines[line], marker)
  return lines.join('\n')
}

export function registerCheckboxes(plugin: Plugin): void {
  let activeMenu: Menu | null = null
  plugin.register(() => activeMenu?.hide())
  const reading = new WeakMap<HTMLInputElement, () => Target | null>()
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    for (const input of Array.from(
      el.querySelectorAll<HTMLInputElement>('li[data-task] > input.task-list-item-checkbox')
    )) {
      reading.set(input, () => {
        const info = ctx.getSectionInfo(input)
        const relative = Number(input.dataset.line)
        if (!info || input.dataset.line === undefined || !Number.isInteger(relative)) return null
        const line = info.lineStart + relative
        const expected = info.text.split('\n')[line]
        const box = checkboxOnLine(expected ?? '')
        const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath)
        if (!box || parseTaskLine(expected) || !(file instanceof TFile)) return null
        return {
          marker: box.state.marker,
          async set(marker) {
            await plugin.app.vault.process(file, (text) =>
              replaceCheckboxLine(text, line, expected, marker)
            )
          },
        }
      })
    }
  })

  const open = (input: HTMLInputElement, point: { x: number; y: number }) => {
    let target = reading.get(input)?.() ?? null
    if (!target && input.hasAttribute('data-task') && input.closest('.cm-content')) {
      const view = EditorView.findFromDOM(input.closest('.cm-editor'))
      const line = input.closest('.cm-line')
      if (view && line)
        target = editorTarget(view, view.state.doc.lineAt(view.posAtDOM(line)).number)
    }
    if (!target) return false
    const selected = target
    activeMenu?.hide()
    const menu = new Menu()
    activeMenu = menu
    menu.onHide(() => {
      if (activeMenu === menu) activeMenu = null
    })
    for (const state of CHECKBOX_STATES) {
      menu.addItem((item) =>
        item
          .setTitle(state.label)
          .setIcon(state.icon)
          .setChecked(state.marker === selected.marker)
          .onClick(() => {
            void Promise.resolve()
              .then(() => selected.set(state.marker))
              .catch((error: unknown) => {
                new Notice(
                  error instanceof Error ? error.message : 'Could not change checkbox state.'
                )
              })
          })
      )
    }
    menu.showAtPosition(point)
    return true
  }
  const attach = (doc: Document) => {
    plugin.register(installCheckboxIcons(doc))
    plugin.register(bindCheckboxMenu(doc, open))
  }
  attach(document)
  plugin.registerEvent(
    plugin.app.workspace.on('window-open', (_window, win) => attach(win.document))
  )
  plugin.addCommand({
    id: 'cycle-checkbox-state',
    name: 'Cycle checkbox state',
    icon: 'list-checks',
    editorCheckCallback(checking, editor: Editor) {
      const view = (editor as Editor & { cm?: EditorView }).cm
      if (!view) return false
      const target = editorTarget(view, editor.getCursor().line + 1)
      if (!target) return false
      if (!checking) void target.set(nextCheckboxState(target.marker))
      return true
    },
  })
}
