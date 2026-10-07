import {
  ButtonComponent,
  Menu,
  Modal,
  Notice,
  Setting,
  MarkdownView,
  type App,
  type Editor,
  type MarkdownPostProcessorContext,
  type Plugin,
} from 'obsidian'
import type { EditorView } from '@codemirror/view'
import { columnsPostProcessor } from './render'
import { registerColumnEntry } from './editor'
import {
  createColumns,
  findColumns,
  changeColumns,
  removeColumns,
  type ColumnTemplate,
  type ColumnChange,
} from './operations'
import { parseColumnsHeader, columnWeights } from './core'
import type { ColumnSource } from './source'

interface Target {
  text: string
  record: ColumnSource
  write: (text: string) => void | Promise<void>
}

export class ColumnRatioModal extends Modal {
  constructor(
    app: App,
    private readonly ratio: number[],
    private readonly save: (ratio: number[]) => void
  ) {
    super(app)
  }
  onOpen(): void {
    this.setTitle('Column proportions')
    let input = this.ratio.join(':')
    new Setting(this.contentEl)
      .setName('Weights')
      .setDesc('One positive number per column, separated by a colon.')
      .addText((text) =>
        text.setValue(input).onChange((value) => {
          input = value
        })
      )
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText('Apply')
          .setCta()
          .onClick(() => {
            const parsed = parseColumnsHeader('[!abele-columns|ratio=' + input.trim() + ']')
            if (!parsed?.ratio || !columnWeights(parsed.ratio, this.ratio.length)) {
              new Notice('Use one positive weight per column.')
              return
            }
            this.save(parsed.ratio)
            this.close()
          })
      )
  }
  onClose(): void {
    this.contentEl.empty()
  }
}

function editorTarget(editor: Editor, record: ColumnSource): Target {
  const text = editor.getValue()
  return {
    text,
    record,
    write(next) {
      if (editor.getValue() !== text) {
        new Notice('The note changed. Open the column menu again.')
        return
      }
      const suffix = text.length - record.to
      const replacement = next.slice(record.from, next.length - suffix)
      editor.replaceRange(
        replacement,
        editor.offsetToPos(record.from),
        editor.offsetToPos(record.to)
      )
      editor.setCursor(editor.offsetToPos(record.from))
      editor.focus()
    },
  }
}
function columnMenu(
  plugin: Plugin,
  target: Target,
  index: number,
  position: { x: number; y: number }
): void {
  const menu = new Menu()
  const change = (action: ColumnChange) => {
    void Promise.resolve(target.write(changeColumns(target.text, target.record, action))).catch(
      (error) => new Notice(error instanceof Error ? error.message : 'Could not update columns.')
    )
  }
  menu.addItem((item) =>
    item
      .setTitle('Add column')
      .setIcon('plus')
      .onClick(() => change({ type: 'add' }))
  )
  menu.addItem((item) =>
    item
      .setTitle('Move column left')
      .setIcon('arrow-left')
      .setDisabled(index <= 0)
      .onClick(() => change({ type: 'move', index, to: index - 1 }))
  )
  menu.addItem((item) =>
    item
      .setTitle('Move column right')
      .setIcon('arrow-right')
      .setDisabled(index >= target.record.columns.length - 1)
      .onClick(() => change({ type: 'move', index, to: index + 1 }))
  )
  menu.addSeparator()
  for (const ratio of target.record.columns.length === 2
    ? [
        [1, 1],
        [2, 1],
        [1, 2],
      ]
    : [Array<number>(target.record.columns.length).fill(1)])
    menu.addItem((item) =>
      item
        .setTitle('Proportions ' + ratio.join(':'))
        .onClick(() => change({ type: 'options', ratio, mobile: target.record.options.mobile }))
    )
  menu.addItem((item) =>
    item
      .setTitle('Custom proportions…')
      .onClick(() =>
        new ColumnRatioModal(
          plugin.app,
          target.record.options.ratio ?? Array<number>(target.record.columns.length).fill(1),
          (ratio) => change({ type: 'options', ratio, mobile: target.record.options.mobile })
        ).open()
      )
  )
  for (const mobile of ['stack', 'keep'] as const)
    menu.addItem((item) =>
      item
        .setTitle(
          mobile === 'stack' ? 'Stack on narrow screens' : 'Keep side by side on narrow screens'
        )
        .setChecked(target.record.options.mobile === mobile)
        .onClick(() =>
          change({
            type: 'options',
            ratio:
              target.record.options.ratio ?? Array<number>(target.record.columns.length).fill(1),
            mobile,
          })
        )
    )
  menu.addSeparator()
  menu.addItem((item) =>
    item
      .setTitle('Remove columns')
      .setIcon('columns-2')
      .onClick(() => {
        void Promise.resolve(target.write(removeColumns(target.text, target.record))).catch(
          (error) => new Notice(String(error))
        )
      })
  )
  menu.showAtPosition(position)
}

export function registerColumns(plugin: Plugin): void {
  registerColumnEntry(plugin)
  const contexts = new WeakMap<HTMLElement, MarkdownPostProcessorContext>()
  const mounted = new WeakSet<HTMLElement>()
  const resolve = async (parent: HTMLElement): Promise<Target | null> => {
    const ctx = contexts.get(parent)
    if (!ctx || parent.closest('.internal-embed')) return null
    const leaf = plugin.app.workspace
      .getLeavesOfType('markdown')
      .find(
        (l) =>
          l.view instanceof MarkdownView &&
          l.view.containerEl.contains(parent) &&
          l.view.file?.path === ctx.sourcePath
      )
    if (!leaf || !(leaf.view instanceof MarkdownView) || !leaf.view.file) return null
    const view = leaf.view
    if (view.getMode() === 'source') {
      const cm = (view.editor as Editor & { cm: EditorView }).cm
      const record = findColumns(view.editor.getValue(), cm.posAtDOM(parent))
      return record ? editorTarget(view.editor, record) : null
    }
    const info = ctx.getSectionInfo(parent)
    if (!info) return null
    const from = info.text
      .split('\n')
      .slice(0, info.lineStart)
      .reduce((n, line) => n + line.length + 1, 0)
    const record = findColumns(info.text, from)
    if (!record) return null
    const file = view.file
    return {
      text: info.text,
      record,
      async write(next) {
        await plugin.app.vault.process(file, (text) => {
          if (text !== info.text) throw Error('The note changed. Open the column menu again.')
          return next
        })
      },
    }
  }
  const open = (parent: HTMLElement, index: number, position: { x: number; y: number }) => {
    void resolve(parent)
      .then((target) => {
        if (target) columnMenu(plugin, target, index, position)
      })
      .catch((error) => new Notice(String(error)))
  }
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    columnsPostProcessor(el)
    const parents = [
      ...(el.matches('.abele-columns') ? [el] : []),
      ...Array.from(el.querySelectorAll<HTMLElement>('.abele-columns')),
    ]
    for (const parent of parents) {
      contexts.set(parent, ctx)
      if (mounted.has(parent)) continue
      mounted.add(parent)
      const controls = parent.ownerDocument.win.createDiv({ cls: 'abele-columns-controls', parent })
      new ButtonComponent(controls)
        .setIcon('columns-2')
        .setTooltip('Column options')
        .onClick((event) => open(parent, 0, { x: event.clientX, y: event.clientY }))
    }
  })
  const attach = (doc: Document) =>
    plugin.registerDomEvent(
      doc,
      'contextmenu',
      (event) => {
        const parent = (event.target as Element).closest<HTMLElement>('.abele-columns')
        if (!parent || !contexts.has(parent) || parent.closest('.internal-embed')) return
        event.preventDefault()
        event.stopImmediatePropagation()
        if (Date.now() < Number(parent.dataset.abeleTapUntil ?? 0)) return
        const columns = Array.from(
          parent.querySelectorAll(':scope > .callout-content > .abele-column')
        )
        const index = columns.indexOf((event.target as Element).closest('.abele-column')!)
        open(parent, Math.max(0, index), { x: event.clientX, y: event.clientY })
      },
      true
    )
  attach(document)
  plugin.registerEvent(
    plugin.app.workspace.on('window-open', (_window, win) => attach(win.document))
  )
  const insert = (editor: Editor, kind: ColumnTemplate) => {
    const before = editor.getValue(),
      from = editor.posToOffset(editor.getCursor('from')),
      to = editor.posToOffset(editor.getCursor('to'))
    const selected = before.slice(from, to)
    const prefix = from > 0 && !before.slice(0, from).endsWith('\n\n') ? '\n\n' : ''
    const suffix = to < before.length && !before.slice(to).startsWith('\n\n') ? '\n\n' : ''
    editor.replaceSelection(prefix + createColumns(selected, kind) + suffix)
    editor.setCursor(editor.offsetToPos(from + prefix.length))
    editor.focus()
  }
  plugin.addCommand({
    id: 'insert-columns',
    name: 'Insert columns',
    editorCallback: (editor) => {
      const menu = new Menu()
      for (const [kind, name] of [
        ['two', 'Two equal columns'],
        ['three', 'Three equal columns'],
        ['aside', 'Text with an aside'],
      ] as const)
        menu.addItem((item) => item.setTitle(name).onClick(() => insert(editor, kind)))
      const cm = (editor as Editor & { cm?: EditorView }).cm,
        r = cm?.coordsAtPos(cm.state.selection.main.head)
      menu.showAtPosition({ x: r?.left ?? 0, y: r?.bottom ?? 0 })
    },
  })
  for (const [kind, name] of [
    ['two', 'Insert two equal columns'],
    ['three', 'Insert three equal columns'],
    ['aside', 'Insert text with an aside'],
  ] as const)
    plugin.addCommand({
      id: 'insert-columns-' + kind,
      name,
      editorCallback: (editor) => insert(editor, kind),
    })
  plugin.addCommand({
    id: 'column-options',
    name: 'Column options',
    editorCheckCallback: (checking, editor) => {
      const record = findColumns(editor.getValue(), editor.posToOffset(editor.getCursor()))
      if (!record) return false
      if (!checking) {
        const cm = (editor as Editor & { cm?: EditorView }).cm,
          r = cm?.coordsAtPos(cm.state.selection.main.head)
        const index = Math.max(
          0,
          record.columns.findIndex(
            (c) =>
              editor.posToOffset(editor.getCursor()) >= c.from &&
              editor.posToOffset(editor.getCursor()) <= c.to
          )
        )
        columnMenu(plugin, editorTarget(editor, record), index, {
          x: r?.left ?? 0,
          y: r?.bottom ?? 0,
        })
      }
      return true
    },
  })
  plugin.addCommand({
    id: 'remove-columns',
    name: 'Remove columns',
    editorCheckCallback: (checking, editor) => {
      const record = findColumns(editor.getValue(), editor.posToOffset(editor.getCursor()))
      if (!record) return false
      if (!checking)
        void editorTarget(editor, record).write(removeColumns(editor.getValue(), record))
      return true
    },
  })
}
