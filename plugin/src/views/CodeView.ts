import { t } from '@/i18n'
import {
  setIcon,
  setTooltip,
  TextFileView,
  WorkspaceLeaf,
  TFile,
  EventRef,
  TextComponent,
  Scope,
} from 'obsidian'
import { EditorView, lineNumbers, keymap } from '@codemirror/view'
import { Extension } from '@codemirror/state'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { SearchQuery, setSearchQuery } from '@codemirror/search'
import { SearchCursor } from '@codemirror/search'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { h, reactive } from 'vue'
import SelectionBar from '@/components/obsidian/SelectionBar.vue'
import { mountKit } from '@/components/obsidian/mount'
import { ASK, ADD, NOTE } from '@/components/obsidian/selectionActions'
import { chatCodeSelection, insertCodeSelection, type CodeSelection } from './codeSelectionHost'
import { isScriptPath } from '@/scripting/scriptPath'
import { noteLocalScriptWrite } from '@/scripting/ScriptTrust'
import { mountFileChats, type FileChatsModel } from './codeViewChats'
import { codeEditing } from '@/editor/codeEditing'

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
  private suppressDirty = false
  /** Save, in the tab's header beside Find, shown only while there is something to save. */
  private saveAction: HTMLElement | null = null
  private modifyRef: EventRef | null = null
  /**
   * The chats linked to the script in this tab, listed under the code as a note lists them in
   * its footer. One element for the life of the view, put back after the code whenever the
   * editor is rebuilt; its path is empty for anything that is not a script.
   */
  private chatsEl: HTMLElement | null = null
  private readonly chatsModel = reactive<FileChatsModel>({ path: '' })
  private unmountSelection: (() => void) | null = null
  private unmountChats: (() => void) | null = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)

    // Prevent Obsidian from intercepting keys that CodeMirror needs.
    // Returning undefined blocks the parent scope chain (HotkeyManager)
    // while letting the DOM event reach CodeMirror in bubble phase.
    this.scope = new Scope(this.app.scope)
    this.scope.register(['Mod'], '/', () => undefined)
    this.scope.register(['Mod'], 'f', () => undefined)
    this.scope.register(['Mod'], 's', () => undefined)
    this.scope.register([], 'Tab', () => undefined)
    this.scope.register(['Shift'], 'Tab', () => undefined)
    this.scope.register(['Mod'], 'z', () => undefined)
    this.scope.register(['Mod', 'Shift'], 'z', () => undefined)
    this.scope.register(['Mod'], 'a', () => undefined)
    this.scope.register(['Mod'], 'd', () => undefined)

    // Save and Find where a tab keeps what can be done with it, its header, as glyphs.
    this.saveAction = this.addAction('save', t('streamC.9d6e26c9ca138daa'), () => {
      void this.save()
      this.setDirty(false)
    })
    this.saveAction.toggle(false)
    this.addAction('search', t('streamC.0df49879fe2f3c6a'), () => this.toggleSearch())
  }

  /**
   * Saves, and when the text was edited in this tab and the file is a script, records it as
   * written on this device — so a script edited here stays confirmed; see `ScriptTrust.ts`.
   * Only an edit counts: a save of text this tab merely reloaded from a synced change would
   * otherwise confirm what arrived without anybody having written it.
   */
  async save(clear?: boolean): Promise<void> {
    const edited = this.dirty
    const path = this.file?.path
    if (edited && path) await noteLocalScriptWrite(path, this.getViewData())
    return super.save(clear)
  }

  getViewType() {
    return CODE_VIEW_TYPE
  }

  getDisplayText() {
    return this.file?.name ?? t('streamC.340f463033e0fd5d')
  }

  getIcon() {
    return 'code'
  }

  getViewData(): string {
    return this.editor?.state.doc.toString() ?? this.data
  }

  setViewData(data: string, clear: boolean): void {
    this.suppressDirty = true
    if (clear || !this.editor) {
      this.buildEditor(data)
    } else {
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: data },
      })
    }
    this.setDirty(false)
    this.suppressDirty = false
  }

  clear(): void {
    this.unmountSelection?.()
    this.unmountSelection = null
    this.editor?.destroy()
    this.editor = null
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file)
    this.startWatching()
    this.showChats(file)
  }

  async onUnloadFile(file: TFile): Promise<void> {
    this.stopWatching()
    this.chatsModel.path = ''
    await super.onUnloadFile(file)
  }

  async onRename(file: TFile): Promise<void> {
    await super.onRename(file)
    this.chatsModel.path = isScriptPath(file.path) ? file.path : ''
  }

  async onClose(): Promise<void> {
    this.unmountSelection?.()
    this.unmountSelection = null
    this.unmountChats?.()
    this.unmountChats = null
    this.chatsEl = null
    await super.onClose()
  }

  private showChats(file: TFile): void {
    this.chatsModel.path = isScriptPath(file.path) ? file.path : ''
    if (!this.chatsEl) {
      this.chatsEl = createDiv({ cls: 'abele-code-chats' })
      this.unmountChats = mountFileChats(this.chatsEl, this.chatsModel)
    }
    this.contentEl.appendChild(this.chatsEl)
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
    this.saveAction?.toggle(value)
  }

  private searchEl: HTMLElement | null = null
  private searchInput: HTMLInputElement | null = null
  private searchCountEl: HTMLElement | null = null

  private toggleSearch() {
    if (!this.searchEl) return
    const visible = !this.searchEl.hasClass('abele-code-search_hidden')
    this.searchEl.toggleClass('abele-code-search_hidden', visible)
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
    this.searchCountEl.textContent =
      count > 0
        ? t('streamC.aa56c9d3302af396', { v1: String(count) })
        : t('streamC.a43619f321175f57')
  }

  private clearSearch() {
    if (!this.editor) return
    const query = new SearchQuery({ search: '' })
    this.editor.dispatch({ effects: setSearchQuery.of(query) })
    if (this.searchCountEl) this.searchCountEl.textContent = ''
  }

  private buildEditor(doc: string) {
    this.unmountSelection?.()
    this.unmountSelection = null
    this.editor?.destroy()
    this.contentEl.empty()

    const header = this.contentEl.createDiv({ cls: 'abele-code-header' })

    // Search bar (hidden by default)
    const search = header.createDiv({ cls: 'abele-code-search abele-code-search_hidden' })
    this.searchEl = search
    const searchComponent = new TextComponent(search)
    searchComponent.setPlaceholder(t('streamC.dec802b13c9c7f29'))
    searchComponent.inputEl.addClass('abele-code-search__input')
    this.searchInput = searchComponent.inputEl
    this.searchCountEl = search.createSpan({ cls: 'abele-code-search__count' })

    // Obsidian's own glyph buttons, each named by its tooltip.
    const glyph = (icon: string, name: string, run: () => void) => {
      const button = search.createDiv({ cls: 'clickable-icon abele-code-search__btn' })
      button.setAttr('role', 'button')
      button.setAttr('tabindex', '0')
      button.setAttr('aria-label', name)
      setIcon(button, icon)
      setTooltip(button, name)
      button.addEventListener('click', run)
      button.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          run()
        }
      })
    }
    glyph('arrow-up', t('streamC.a1ac3c3a93fa2373'), () => this.goToPrev())
    glyph('arrow-down', t('streamC.115967f77ac62494'), () => this.goToNext())
    glyph('x', t('streamC.4421ecff0746b96c'), () => this.toggleSearch())

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

    const ext = this.file?.extension ?? ''
    const langFactory = langByExt[ext]

    this.editor = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          lineNumbers(),
          history(),
          ...codeEditing(),
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
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.suppressDirty) {
              this.setDirty(true)
            }
          }),
        ],
      }),
      parent: this.contentEl,
    })
    // `contentEl.empty()` above took the list of chats out with everything else.
    if (this.chatsEl) this.contentEl.appendChild(this.chatsEl)
    const scope = this.editor.dom
    const host = this.contentEl.createDiv()
    const bar = mountKit(host, {
      render: () =>
        h(SelectionBar, {
          scope,
          within: '.cm-content',
          actions: [ASK, ADD, NOTE],
          onPick: (action: string, words: CodeSelection) => {
            const path = this.file?.path
            if (!path || !words.from || !words.to) return
            const selection = {
              text: words.text,
              from: words.from,
              to: words.to,
              side: 'after' as const,
            }
            if (action === 'note') insertCodeSelection(this.app, path, selection)
            else if (action === 'ask' || action === 'add')
              void chatCodeSelection(action, path, selection).catch((error: unknown) => {
                console.error('[Abele] Code selection action failed:', error)
              })
          },
        }),
    })
    this.unmountSelection = bar.unmount
  }
}
