import { setIcon, TextFileView, WorkspaceLeaf, TFile, EventRef } from 'obsidian'
import {
  EditorView,
  lineNumbers,
  keymap,
  highlightActiveLine,
  drawSelection,
} from '@codemirror/view'
import { Extension } from '@codemirror/state'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'

export const CODE_VIEW_TYPE = 'abele-code'

const langByExt: Record<string, () => Extension> = {
  json: json,
  base: yaml,
  js: javascript,
  ts: () => javascript({ typescript: true }),
  css: css,
  html: html,
  xml: xml,
  svg: xml,
  yaml: yaml,
  yml: yaml,
}

export class CodeView extends TextFileView {
  private editor: EditorView | null = null
  private dirty = false
  private saveBtn: HTMLButtonElement | null = null
  private modifyRef: EventRef | null = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }

  getViewType() {
    return CODE_VIEW_TYPE
  }

  getDisplayText() {
    return this.file?.name ?? 'Code'
  }

  getIcon() {
    return 'code'
  }

  getViewData(): string {
    return this.editor?.state.doc.toString() ?? this.data
  }

  setViewData(data: string, clear: boolean): void {
    if (clear || !this.editor) {
      this.buildEditor(data)
    } else {
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: data },
      })
    }
    this.setDirty(false)
  }

  clear(): void {
    this.editor?.destroy()
    this.editor = null
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file)
    this.startWatching()
  }

  async onUnloadFile(file: TFile): Promise<void> {
    this.stopWatching()
    await super.onUnloadFile(file)
  }

  private startWatching() {
    this.stopWatching()
    this.modifyRef = this.app.vault.on('modify', async (modified) => {
      if (!(modified instanceof TFile)) return
      if (modified.path !== this.file?.path) return
      if (this.dirty) return
      const content = await this.app.vault.read(modified)
      const current = this.editor?.state.doc.toString() ?? ''
      if (content !== current) {
        this.setViewData(content, false)
      }
    })
  }

  private stopWatching() {
    if (this.modifyRef) {
      this.app.vault.offref(this.modifyRef)
      this.modifyRef = null
    }
  }

  private setDirty(value: boolean) {
    this.dirty = value
    if (this.saveBtn) {
      this.saveBtn.disabled = !value
    }
  }

  private buildEditor(doc: string) {
    this.editor?.destroy()
    this.contentEl.empty()

    const toolbar = this.contentEl.createDiv({ cls: 'abele-code-toolbar' })
    this.saveBtn = toolbar.createEl('button', { cls: 'abele-code-save-btn' })
    this.saveBtn.disabled = true
    setIcon(this.saveBtn, 'save')
    this.saveBtn.createSpan({ text: 'Save' })
    this.saveBtn.addEventListener('click', () => {
      this.save()
      this.setDirty(false)
    })

    const ext = this.file?.extension ?? ''
    const langFactory = langByExt[ext]

    this.editor = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          lineNumbers(),
          foldGutter(),
          history(),
          drawSelection(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          ...(langFactory ? [langFactory()] : []),
          EditorView.lineWrapping,
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                this.save()
                this.setDirty(false)
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.setDirty(true)
            }
          }),
        ],
      }),
      parent: this.contentEl,
    })
  }
}
