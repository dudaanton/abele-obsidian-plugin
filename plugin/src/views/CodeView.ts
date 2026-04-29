import { setIcon, TextFileView, WorkspaceLeaf, TFile, EventRef, TextComponent } from 'obsidian'
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
import { highlightSelectionMatches, SearchQuery, setSearchQuery } from '@codemirror/search'
import { SearchCursor } from '@codemirror/search'
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

  async onOpen(): Promise<void> {
    // Scope register here (view fully initialized) — captures Cmd+F on Mac
    this.scope.register(['Mod'], 'f', (e) => {
      e.preventDefault()
      this.toggleSearch()
      return false
    })
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

  private searchEl: HTMLElement | null = null
  private searchInput: HTMLInputElement | null = null
  private searchCountEl: HTMLElement | null = null

  private toggleSearch() {
    if (!this.searchEl) return
    const visible = this.searchEl.style.display !== 'none'
    this.searchEl.style.display = visible ? 'none' : 'flex'
    if (!visible) {
      // Pre-fill with selected text
      if (this.editor && this.searchInput) {
        const sel = this.editor.state.sliceDoc(
          this.editor.state.selection.main.from,
          this.editor.state.selection.main.to
        )
        if (sel && !sel.includes('\n')) {
          this.searchInput.value = sel
          this.doSearch()
        }
      }
      this.searchInput?.focus()
      this.searchInput?.select()
    } else {
      this.clearSearch()
    }
  }

  private doSearch() {
    if (!this.editor || !this.searchInput) return
    const term = this.searchInput.value
    const query = new SearchQuery({ search: term, caseSensitive: false })
    this.editor.dispatch({ effects: setSearchQuery.of(query) })
    this.updateSearchCount()
    if (term) this.goToNext()
  }

  private goToNext() {
    if (!this.editor || !this.searchInput?.value) return
    const doc = this.editor.state.doc
    const from = this.editor.state.selection.main.to
    const cursor = new SearchCursor(doc, this.searchInput.value, from)
    let result = cursor.next()
    if (result.done) {
      // Wrap around
      const wrap = new SearchCursor(doc, this.searchInput.value, 0)
      result = wrap.next()
    }
    if (!result.done) {
      this.editor.dispatch({
        selection: { anchor: result.value.from, head: result.value.to },
        scrollIntoView: true,
      })
    }
  }

  private goToPrev() {
    if (!this.editor || !this.searchInput?.value) return
    const doc = this.editor.state.doc
    const to = this.editor.state.selection.main.from
    const term = this.searchInput.value
    // SearchCursor only goes forward; collect all matches and pick the previous one
    const cursor = new SearchCursor(doc, term, 0)
    const matches: { from: number; to: number }[] = []
    while (!cursor.next().done) {
      matches.push({ from: cursor.value.from, to: cursor.value.to })
    }
    if (matches.length === 0) return
    const prev = matches.filter((m) => m.to <= to).pop() || matches[matches.length - 1]
    this.editor.dispatch({
      selection: { anchor: prev.from, head: prev.to },
      scrollIntoView: true,
    })
  }

  private updateSearchCount() {
    if (!this.editor || !this.searchCountEl || !this.searchInput) return
    const term = this.searchInput.value
    if (!term) {
      this.searchCountEl.textContent = ''
      return
    }
    const cursor = new SearchCursor(this.editor.state.doc, term, 0)
    let count = 0
    while (!cursor.next().done) count++
    this.searchCountEl.textContent = count > 0 ? `${count} found` : 'No results'
  }

  private clearSearch() {
    if (!this.editor) return
    const query = new SearchQuery({ search: '' })
    this.editor.dispatch({ effects: setSearchQuery.of(query) })
    if (this.searchCountEl) this.searchCountEl.textContent = ''
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

    toolbar.createSpan({ cls: 'abele-code-toolbar__sep' })

    const searchBtn = toolbar.createEl('button', { cls: 'abele-code-save-btn' })
    setIcon(searchBtn, 'search')
    searchBtn.createSpan({ text: 'Find' })
    searchBtn.addEventListener('click', () => this.toggleSearch())

    // Search bar (hidden by default)
    this.searchEl = this.contentEl.createDiv({ cls: 'abele-code-search' })
    this.searchEl.style.display = 'none'
    const searchComponent = new TextComponent(this.searchEl)
    searchComponent.setPlaceholder('Find...')
    searchComponent.inputEl.addClass('abele-code-search__input')
    this.searchInput = searchComponent.inputEl
    this.searchCountEl = this.searchEl.createSpan({ cls: 'abele-code-search__count' })

    const prevBtn = this.searchEl.createEl('button', { cls: 'abele-code-search__btn' })
    setIcon(prevBtn, 'chevron-up')
    prevBtn.addEventListener('click', () => this.goToPrev())

    const nextBtn = this.searchEl.createEl('button', { cls: 'abele-code-search__btn' })
    setIcon(nextBtn, 'chevron-down')
    nextBtn.addEventListener('click', () => this.goToNext())

    const closeBtn = this.searchEl.createEl('button', { cls: 'abele-code-search__btn' })
    setIcon(closeBtn, 'x')
    closeBtn.addEventListener('click', () => this.toggleSearch())

    this.searchInput.addEventListener('input', () => this.doSearch())
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) this.goToPrev()
        else this.goToNext()
      } else if (e.key === 'Escape') {
        this.toggleSearch()
      }
    })

    // Capture Ctrl+F before Obsidian's global handler
    this.contentEl.addEventListener(
      'keydown',
      (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
          e.preventDefault()
          e.stopPropagation()
          this.toggleSearch()
        }
      },
      true
    )

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
            {
              key: 'Mod-f',
              run: () => {
                this.toggleSearch()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
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
