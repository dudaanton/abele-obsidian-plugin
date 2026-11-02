// Disposable qualification instrumentation. Mutate callbacks in place so the
// host retains class, extension, field, facet and private-field identities.
exports.installHostEntries = function ({ ledger, wrap, owned, patch: installPatch, Plugin, Component,
  ItemView, FileView, View, MarkdownRenderChild, EditorSuggest, PluginSettingTab, codeMirror = {} }) {
  const bases = new Set([Component, Plugin, ItemView, FileView, View, MarkdownRenderChild,
    EditorSuggest, PluginSettingTab, codeMirror.WidgetType].filter(Boolean).map(Class => Class.prototype))
  const instances = new WeakSet(), contexts = new WeakSet(), extensions = new WeakSet()
  const ownFields = new WeakSet(), ownFacets = new WeakSet()
  const partial = label => ledger.markPartial(label)
  const patch = (object, name, replaceMethod) => {
    if (typeof object?.[name] !== 'function') return
    const original = object[name]
    try {
      installPatch(object, name, replaceMethod)
      if (object[name] === original) partial(`Host registration ${name}: non-replaceable method`)
    } catch { partial(`Host registration ${name}: non-replaceable method`) }
  }
  const replace = (object, key, descriptor, label, fallback) => {
    try { Object.defineProperty(object, key, descriptor) }
    catch {
      try {
        if (!fallback || fallback === object) throw new Error('No mutable instance')
        Object.defineProperty(fallback, key, { ...descriptor, configurable: true })
      } catch { partial(`${label}: non-replaceable method or callback`) }
    }
  }
  const instance = (value, label) => {
    if (!value || typeof value !== 'object' || instances.has(value)) return value
    instances.add(value)
    for (let object = value; object && object !== Object.prototype && !bases.has(object);
      object = Object.getPrototypeOf(object)) {
      for (const key of Reflect.ownKeys(object)) {
        if (key === 'constructor') continue
        const descriptor = Object.getOwnPropertyDescriptor(object, key)
        const next = { ...descriptor }
        let changed = false
        for (const slot of ['value', 'get', 'set']) if (typeof descriptor[slot] === 'function') {
          next[slot] = wrap(descriptor[slot], `${label}:method`)
          changed ||= next[slot] !== descriptor[slot]
        }
        if (changed) replace(object, key, next, label, value)
      }
    }
    return value
  }
  const factory = (fn, label) => wrap(function () {
    return instance(Reflect.apply(fn, this, arguments), label)
  }, `${label}:construction`)
  const callbacks = (value, label, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    // Callback specs are records/arrays. Do not descend into DOM, RangeSet,
    // editor state, or other host instances referenced as data by the spec.
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) return
    seen.add(value)
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!('value' in descriptor)) {
        const next = { ...descriptor }
        if (descriptor.get) next.get = wrap(function () {
          const result = Reflect.apply(descriptor.get, this, arguments)
          if (typeof result === 'function') return wrap(result, `${label}:callback`)
          callbacks(result, label, seen)
          return result
        }, `${label}:get`)
        if (descriptor.set) next.set = wrap(descriptor.set, `${label}:set`)
        replace(value, key, next, label)
        continue
      }
      if (typeof descriptor.value === 'function') {
        const next = wrap(descriptor.value, `${label}:callback`)
        if (next !== descriptor.value) replace(value, key, { ...descriptor, value: next }, label)
      } else callbacks(descriptor.value, label, seen)
    }
  }
  const functionField = (object, key, label, create = false) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    if (!descriptor || typeof descriptor.value !== 'function') return
    const next = create ? factory(descriptor.value, label) : wrap(descriptor.value, label)
    if (next !== descriptor.value) replace(object, key, { ...descriptor, value: next }, label)
  }
  const extension = value => {
    if (!value || typeof value !== 'object') {
      partial('Editor extension: unsupported non-object extension')
      return
    }
    if (extensions.has(value)) return
    extensions.add(value)
    if (Array.isArray(value)) { for (const child of value) extension(child); return }
    // ViewPlugin instances retain create + extension data; factories cover the
    // actual constructor, then all plugin value methods, including arrow fields.
    if (typeof value.create === 'function' && Array.isArray(value.baseExtensions)) {
      functionField(value, 'create', 'ViewPlugin', true)
      callbacks(value.domEventHandlers, 'ViewPlugin handlers')
      callbacks(value.domEventObservers, 'ViewPlugin observers')
      extensionIfPresent(value.extension)
    } else if (typeof value.createF === 'function' && typeof value.updateF === 'function') {
      if (!ownFields.has(value)) partial('StateField: definition predates owned callback hooks')
      else { callbacks(value.spec, 'StateField spec'); extensionIfPresent(value.provides) }
    } else if (value.facet && Object.hasOwn(value, 'value') && Number.isInteger(value.type)) {
      // A host facet may be shared by all plugins. Only definitions observed
      // inside our entry are ours; never rewrite a shared host reducer.
      if (ownFacets.has(value.facet)) extensionIfPresent(value.facet.extensions)
      functionField(value, 'value', 'Facet provider')
      if (value.value?.plugin) extension(value.value.plugin)
      else callbacks(value.value, 'Facet value')
    } else if (Object.hasOwn(value, 'inner')) {
      extension(value.inner)
      if (value.compartment && typeof value.compartment.reconfigure === 'function')
        patch(value.compartment, 'reconfigure', original => function (content) {
          extension(content)
          return original.call(this, content)
        })
    } else {
      // Extension wrappers may expose a getter rather than a data property.
      let object = value, descriptor
      while (object && object !== Object.prototype) {
        descriptor = Object.getOwnPropertyDescriptor(object, 'extension')
        if (descriptor) break
        object = Object.getPrototypeOf(object)
      }
      if (descriptor?.get) replace(value, 'extension', { ...descriptor,
        configurable: object === value ? descriptor.configurable : true,
        get: wrap(descriptor.get, 'Extension getter') }, 'Extension getter')
      const nested = value.extension
      if (nested && nested !== value) extension(nested)
      else partial('Editor extension: unsupported extension shape')
    }
  }
  const extensionIfPresent = value => { if (value != null) extension(value) }
  patch(codeMirror.ViewPlugin, 'define', original => function (create, spec) {
    if (!owned()) return original.apply(this, arguments)
    callbacks(spec, 'ViewPlugin spec')
    const result = original.call(this, factory(create, 'ViewPlugin'), spec)
    extension(result)
    return result
  })
  for (const [Class, label, known] of [[codeMirror.StateField, 'StateField', ownFields],
    [codeMirror.Facet, 'Facet', ownFacets]])
    patch(Class, 'define', original => function (spec) {
      if (!owned()) return original.apply(this, arguments)
      callbacks(spec, `${label} spec`)
      const result = original.apply(this, arguments)
      known.add(result)
      if (label === 'StateField') extension(result)
      return result
    })
  for (const name of ['of', 'compute', 'computeN', 'from'])
    patch(codeMirror.Facet?.prototype, name, original => function () {
      const result = original.apply(this, arguments)
      if (owned()) extension(result)
      return result
    })
  patch(codeMirror.Compartment?.prototype, 'reconfigure', original => function (content) {
    if (owned()) extension(content)
    return original.apply(this, arguments)
  })
  for (const name of ['widget', 'replace'])
    patch(codeMirror.Decoration, name, original => function (spec) {
      if (owned() && spec?.widget) instance(spec.widget, 'WidgetType')
      return original.apply(this, arguments)
    })
  const ours = object => object?.manifest?.id === 'abele' || instances.has(object) || owned()
  patch(Plugin?.prototype, 'registerView', original => function (type, creator) {
    return original.call(this, type, ours(this) ? factory(creator, 'view') : creator)
  })
  for (const [name, label] of [['registerEditorSuggest', 'EditorSuggest'], ['addSettingTab', 'settings']])
    patch(Plugin?.prototype, name, original => function (value) {
      if (ours(this)) instance(value, label)
      return original.apply(this, arguments)
    })
  patch(Plugin?.prototype, 'registerEditorExtension', original => function (value) {
    if (ours(this)) extension(value)
    return original.apply(this, arguments)
  })
  patch(Component?.prototype, 'addChild', original => function (child) {
    if (ours(this)) instance(child, 'component child')
    return original.apply(this, arguments)
  })
  const context = value => {
    if (!value || typeof value.addChild !== 'function' || contexts.has(value)) return
    contexts.add(value)
    patch(value, 'addChild', original => function (child) {
      if (owned()) instance(child, 'MarkdownRenderChild')
      return original.apply(this, arguments)
    })
  }
  for (const name of ['registerMarkdownPostProcessor', 'registerMarkdownCodeBlockProcessor'])
    patch(Plugin?.prototype, name, original => function () {
      if (ours(this)) {
        const at = name === 'registerMarkdownPostProcessor' ? 0 : 1, fn = arguments[at]
        arguments[at] = wrap(function () {
          for (const value of arguments) context(value)
          return Reflect.apply(fn, this, arguments)
        }, 'markdown processor')
      }
      return original.apply(this, arguments)
    })
  patch(Plugin?.prototype, 'registerCodeMirror', original => function (fn) {
    if (!ours(this)) return original.apply(this, arguments)
    return original.call(this, wrap(function (editor) {
      if (!contexts.has(editor)) {
        contexts.add(editor)
        const registrations = new Map()
        patch(editor, 'on', on => function (event, callback) {
          const actual = owned() ? wrap(callback, 'legacy editor event') : callback
          const rows = registrations.get(event) ?? []
          rows.push({ callback, actual }); registrations.set(event, rows)
          return on.call(this, event, actual)
        })
        patch(editor, 'off', off => function (event, callback) {
          const rows = registrations.get(event), at = rows?.findIndex(row =>
            row.callback === callback || row.actual === callback) ?? -1
          const actual = at < 0 ? callback : rows.splice(at, 1)[0].actual
          if (rows?.length === 0) registrations.delete(event)
          return off.call(this, event, actual)
        })
      }
      return fn.apply(this, arguments)
    }, 'legacy editor'))
  })
}
