// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import asyncHooks from 'node:async_hooks'
const require = createRequire(import.meta.url)
const api = require('../scale/entry-ledger.cjs')
const codeMirror = { ...require('@codemirror/state'), ...require('@codemirror/view') }

function fixture() {
  const rows: any[] = []
  const ledger = api.createEntryLedger({ device: '0', write: (text: string) =>
    rows.push(...text.trim().split('\n').flatMap(line => api.decodeEntryBatch(JSON.parse(line)))) })
  class Component { addChild(child: any) { return child } load() { (this as any).onload?.() } unload() { (this as any).onunload?.() } }
  class ItemView extends Component { hostOnly() { expect(ledger.active()).toBe(false) } }
  class MarkdownRenderChild extends Component {}
  class EditorSuggest {}
  class PluginSettingTab {}
  class Plugin extends Component {
    manifest = { id: 'abele' }
    views: any[] = []; extensions: any[] = []; processors: any[] = []; legacy: any[] = []
    registerView(_name: string, creator: any) { this.views.push(creator) }
    registerEditorExtension(extension: any) { this.extensions.push(extension) }
    registerCodeMirror(callback: any) { this.legacy.push(callback) }
    registerEditorSuggest(value: any) { return value }
    addSettingTab(value: any) { return value }
    registerMarkdownPostProcessor(callback: any) { this.processors.push(callback) }
  }
  const close = api.installEntryLedger({ ledger, target: {}, Component, Plugin,
    ItemView, MarkdownRenderChild, EditorSuggest, PluginSettingTab, codeMirror, asyncHooks })
  const plugin = new Plugin()
  return { rows, ledger, close, plugin, ItemView, MarkdownRenderChild, EditorSuggest, PluginSettingTab,
    register: (fn: any) => ledger.wrap(fn, 'plugin:onload')(),
    complete: () => rows.findLast(row => row.event === 'plugin-entry-ledger-checkpoint')?.complete }
}

it('roots registered view construction, all custom methods/accessors and async continuations', async () => {
  const f = fixture()
  class View extends f.ItemView {
    constructor() { super(); expect(f.ledger.active()).toBe(true) }
    onOpen() { expect(f.ledger.active()).toBe(true) }
    onClose() { expect(f.ledger.active()).toBe(true) }
    onResize() { expect(f.ledger.active()).toBe(true) }
    getState() { expect(f.ledger.active()).toBe(true); return 1 }
    onPaneMenu() { expect(f.ledger.active()).toBe(true) }
    arbitraryHostMethod() { expect(f.ledger.active()).toBe(true) }
    get label() { expect(f.ledger.active()).toBe(true); return 'sample' }
    async setState() { expect(f.ledger.active()).toBe(true); await Promise.resolve(); expect(f.ledger.active()).toBe(true) }
  }
  try {
    f.register(() => f.plugin.registerView('sample', () => new View()))
    const view = f.plugin.views[0]()
    expect(view).toBeInstanceOf(View)
    for (const method of ['onOpen', 'onClose', 'onResize', 'getState', 'onPaneMenu', 'arbitraryHostMethod']) view[method]()
    expect(view.label).toBe('sample')
    await view.setState()
    view.hostOnly()
  } finally { await f.close() }
  expect(f.complete()).toBe(true)
})
it('roots MarkdownRenderChild callbacks returned through a processor context', async () => {
  const f = fixture()
  let child: any
  class Child extends f.MarkdownRenderChild {
    onload() { expect(f.ledger.active()).toBe(true) }
    onunload() { expect(f.ledger.active()).toBe(true) }
    update() { expect(f.ledger.active()).toBe(true) }
  }
  try {
    f.register(() => f.plugin.registerMarkdownPostProcessor((_element: any, context: any) => context.addChild(new Child())))
    f.plugin.processors[0]({}, { addChild(value: any) { child = value } })
    child.load(); child.update(); child.unload()
  } finally { await f.close() }
  expect(f.complete()).toBe(true)
})
it('roots EditorSuggest methods and settings display/hide without changing identities', async () => {
  const f = fixture()
  class Suggest extends f.EditorSuggest {
    onTrigger() { expect(f.ledger.active()).toBe(true) }
    getSuggestions() { expect(f.ledger.active()).toBe(true); return [] }
    renderSuggestion() { expect(f.ledger.active()).toBe(true) }
    selectSuggestion() { expect(f.ledger.active()).toBe(true) }
  }
  class Tab extends f.PluginSettingTab {
    display = () => { expect(f.ledger.active()).toBe(true) }
    hide() { expect(f.ledger.active()).toBe(true) }
  }
  try {
    const suggest = new Suggest(), tab = new Tab()
    f.register(() => {
      expect(f.plugin.registerEditorSuggest(suggest)).toBe(suggest)
      expect(f.plugin.addSettingTab(tab)).toBe(tab)
    })
    suggest.onTrigger(); suggest.getSuggestions(); suggest.renderSuggestion(); suggest.selectSuggestion()
    tab.display(); tab.hide()
  } finally { await f.close() }
  expect(f.complete()).toBe(true)
})
it('roots real CodeMirror ViewPlugin, StateField, Facet and decoration provider callbacks', async () => {
  const f = fixture()
  const { ViewPlugin, StateField, Facet, EditorView, Prec, Compartment } = codeMirror
  let extension: any, field: any, facet: any, provider: any, value: any
  try {
    f.register(() => {
      extension = ViewPlugin.fromClass(class {
        constructor() { expect(f.ledger.active()).toBe(true) }
        update() { expect(f.ledger.active()).toBe(true) }
        destroy() { expect(f.ledger.active()).toBe(true) }
      }, { decorations() { expect(f.ledger.active()).toBe(true); return 'decorations' } })
      field = StateField.define({ create() { expect(f.ledger.active()).toBe(true); return 1 },
        update(value: number) { expect(f.ledger.active()).toBe(true); return value },
        toJSON(value: number) { expect(f.ledger.active()).toBe(true); return value } })
      facet = Facet.define({ combine(values: any[]) { expect(f.ledger.active()).toBe(true); return values } })
      provider = facet.compute([], () => { expect(f.ledger.active()).toBe(true); return 2 })
      f.plugin.registerEditorExtension([Prec.high(extension), field, new Compartment().of(provider),
        EditorView.decorations.of(() => { expect(f.ledger.active()).toBe(true); return 'sample' })])
    })
    value = extension.create({})
    value.update(); value.destroy()
    field.createF({}); field.updateF(1, {}); field.spec.toJSON(1)
    facet.combine([]); provider.value({})
    const decorations = extension.baseExtensions[0]
    expect(decorations.value({ plugin: () => value })).toBe('decorations')
    expect(f.plugin.extensions[0][3].value({})).toBe('sample')
  } finally { await f.close() }
  expect(f.complete()).toBe(true)
})
it('does not wrap shared host facet reducers and keeps dynamic compartment callbacks covered', async () => {
  const f = fixture()
  // Created outside a product entry: a shared host facet must stay host-owned.
  const facet = codeMirror.Facet.define({ combine() { expect(f.ledger.active()).toBe(false); return 0 } })
  const compartment = new codeMirror.Compartment()
  try {
    f.register(() => f.plugin.registerEditorExtension(compartment.of(facet.of(1))))
    facet.combine([])
    f.register(() => compartment.reconfigure(facet.compute([], () => { expect(f.ledger.active()).toBe(true); return 1 })))
    const effect = f.register(() => compartment.reconfigure(facet.compute([], () => { expect(f.ledger.active()).toBe(true); return 1 })))
    effect.value.extension.value({})
  } finally { await f.close() }
  expect(f.complete()).toBe(true)
})
it('roots legacy editor event callbacks and retains specific immutable-method refusal evidence', async () => {
  const f = fixture()
  let callback: any
  try {
    f.register(() => f.plugin.registerCodeMirror((editor: any) => editor.on('change', () => expect(f.ledger.active()).toBe(true))))
    f.plugin.legacy[0]({ on(_name: string, fn: any) { callback = fn } })
    callback()
    f.register(() => f.plugin.addSettingTab(Object.freeze({ display() {} })))
  } finally { await f.close() }
  expect(f.complete()).toBe(false)
  expect(f.rows.some(row => row.event === 'plugin-entry-ledger-partial' && /non-replaceable/.test(row.reason))).toBe(true)
})
it('roots widget methods and dynamic facet callbacks created after initial registration', async () => {
  const f = fixture()
  const { WidgetType, Decoration, EditorView, StateField } = codeMirror
  let widget: any, dynamic: any, field: any
  class Widget extends WidgetType {
    toDOM() { expect(f.ledger.active()).toBe(true); return {} }
    destroy() { expect(f.ledger.active()).toBe(true) }
  }
  try {
    f.register(() => {
      widget = new Widget()
      Decoration.widget({ widget })
      dynamic = EditorView.decorations.of(() => { expect(f.ledger.active()).toBe(true); return 'sample' })
      field = StateField.define({ create: () => 0, update: (value: number) => value })
      f.plugin.registerEditorExtension(field)
    })
    widget.toDOM(); widget.destroy(); dynamic.value({})
  } finally { await f.close() }
  expect(f.complete()).toBe(true)
})
it('preserves legacy on/off for owned and host callbacks', async () => {
  const f = fixture(), listeners: any[] = []
  const editor = { on(_event: string, fn: any) { listeners.push(fn) },
    off(_event: string, fn: any) { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1) } }
  const callback = () => {}
  try {
    f.register(() => f.plugin.registerCodeMirror(() => {}))
    f.plugin.legacy[0](editor)
    editor.on('sample', callback)
    f.register(() => editor.on('sample', callback))
    editor.off('sample', callback)
    editor.off('sample', callback)
    expect(listeners).toHaveLength(0)
  } finally { await f.close() }
})
it('shadows a frozen view prototype on a mutable instance instead of declaring partial', async () => {
  const f = fixture()
  class View extends f.ItemView { onOpen() { expect(f.ledger.active()).toBe(true) } }
  Object.freeze(View.prototype)
  try {
    f.register(() => f.plugin.registerView('sample', () => new View()))
    f.plugin.views[0]().onOpen()
  } finally { await f.close() }
  expect(f.complete()).toBe(true)
})
it('roots mutable callback-spec and extension getters instead of declaring partial', async () => {
  const f = fixture()
  let field: any
  try {
    f.register(() => {
      field = codeMirror.StateField.define({
        get create() { return () => { expect(f.ledger.active()).toBe(true); return 1 } },
        update: (value: number) => value,
      })
      f.plugin.registerEditorExtension({ get extension() { expect(f.ledger.active()).toBe(true); return field } })
    })
    expect(f.plugin.extensions[0].extension).toBe(field)
    field.spec.create({})
    field.createF({})
  } finally { await f.close() }
  expect(f.complete()).toBe(true)
})
