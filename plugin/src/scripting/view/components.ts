/**
 * What a script builds a view out of.
 *
 * Each class is a description, not an element: a `Button` here knows its text and who to call
 * when pressed, and nothing about DOM. The renderer (`ScriptNode.vue`) turns each one into the
 * matching component of the kit. Instances are reactive proxies, so the script changes what is
 * on screen by assigning a property, and there is no `render()` to remember.
 *
 * Handlers arrive two ways — `onClick` in the constructor or `.on('click', fn)` later — and
 * mean the same thing. `emit` awaits them in order and lets a throw escape; the renderer wraps
 * every emit in `View.run`, which reports the error and keeps the view alive.
 */
import { reactive } from 'vue'

export type Handler = (...args: any[]) => unknown

export type NodeType =
  | 'stack'
  | 'row'
  | 'grid'
  | 'section'
  | 'tabs'
  | 'setting'
  | 'markdown'
  | 'text'
  | 'image'
  | 'table'
  | 'badge'
  | 'empty'
  | 'button'
  | 'icon'
  | 'input'
  | 'select'
  | 'checkbox'
  | 'search'
  | 'card'
  | 'html'

/** Props every node shares. `on*` keys are handlers and are taken off before assignment. */
export interface BaseProps {
  id?: string
  hidden?: boolean
  cls?: string
  [handler: `on${string}`]: Handler | undefined
}

let seq = 0

export abstract class ViewNode {
  abstract readonly type: NodeType
  /** Stable identity for the renderer's keyed lists. Never shown. */
  readonly key: string
  id?: string
  hidden = false
  cls?: string
  children: ViewNode[] = []
  handlers: Record<string, Handler[]> = {}

  constructor() {
    this.key = `n${++seq}`
    // Every instance is a proxy from birth: subclass field initialisers and the script's own
    // assignments all land on the proxy, which is what makes assignment a re-render.
    return reactive(this) as this
  }

  /**
   * Assigns props, routing `onX` keys to `on('x')`. Called by each subclass constructor.
   *
   * Takes a bare `object` rather than `Record<string, unknown>`: every props type here carries
   * `BaseProps`' `on${string}` index signature, and TypeScript will not widen a template-literal
   * index signature to a string one, so the narrower parameter would reject every caller.
   */
  protected assign(props: object): void {
    for (const [k, v] of Object.entries(props) as Array<[string, unknown]>) {
      if (v === undefined) continue
      if (/^on[A-Z]/.test(k) && typeof v === 'function') {
        this.on(k[2].toLowerCase() + k.slice(3), v as Handler)
      } else {
        ;(this as Record<string, unknown>)[k] = v
      }
    }
  }

  on(event: string, fn: Handler): this {
    ;(this.handlers[event] ??= []).push(fn)
    return this
  }

  off(event: string, fn?: Handler): this {
    if (!fn) delete this.handlers[event]
    else this.handlers[event] = (this.handlers[event] ?? []).filter((h) => h !== fn)
    return this
  }

  has(event: string): boolean {
    return (this.handlers[event]?.length ?? 0) > 0
  }

  async emit(event: string, ...args: unknown[]): Promise<void> {
    for (const fn of this.handlers[event] ?? []) await fn(...args)
  }

  add(...nodes: ViewNode[]): this {
    this.children.push(...nodes)
    return this
  }

  remove(node: ViewNode): this {
    const i = this.children.indexOf(node)
    if (i >= 0) this.children.splice(i, 1)
    return this
  }

  clear(): this {
    this.children.splice(0)
    return this
  }

  update(patch: Partial<this>): this {
    this.assign(patch)
    return this
  }

  /** Everything below this node, for `find` and for the inspector. Subclasses widen it. */
  nested(): ViewNode[] {
    return this.children
  }

  find(id: string): ViewNode | undefined {
    for (const child of this.nested()) {
      if (child.id === id) return child
      const deep = child.find(id)
      if (deep) return deep
    }
    return undefined
  }
}

export function isNode(value: unknown): value is ViewNode {
  return value instanceof ViewNode
}

/** A layout constructor takes its children bare, or props with `children` among them. */
function unpack<P extends object>(
  arg: ViewNode[] | (P & { children?: ViewNode[] })
): P & { children?: ViewNode[] } {
  return Array.isArray(arg) ? ({ children: arg } as P & { children: ViewNode[] }) : arg
}

// ── Layout ──

export type Gap = 'none' | 'small' | 'medium' | 'large'

export class Stack extends ViewNode {
  readonly type = 'stack' as const
  gap: Gap = 'medium'
  constructor(arg: ViewNode[] | (BaseProps & { children?: ViewNode[]; gap?: Gap }) = []) {
    super()
    this.assign(unpack(arg))
  }
}

export class Row extends ViewNode {
  readonly type = 'row' as const
  gap: Gap = 'medium'
  align: 'start' | 'center' | 'end' | 'between' = 'start'
  wrap = true
  constructor(
    arg:
      | ViewNode[]
      | (BaseProps & {
          children?: ViewNode[]
          gap?: Gap
          align?: Row['align']
          wrap?: boolean
        }) = []
  ) {
    super()
    this.assign(unpack(arg))
  }
}

export class Grid extends ViewNode {
  readonly type = 'grid' as const
  wide = false
  stack = false
  constructor(
    arg: ViewNode[] | (BaseProps & { children?: ViewNode[]; wide?: boolean; stack?: boolean }) = []
  ) {
    super()
    this.assign(unpack(arg))
  }
}

export class Section extends ViewNode {
  readonly type = 'section' as const
  title?: string
  desc?: string
  constructor(props: BaseProps & { title?: string; desc?: string; children?: ViewNode[] }) {
    super()
    this.assign(props)
  }
}

export interface TabSpec {
  id: string
  label: string
  icon?: string
  tooltip?: string
  content: ViewNode | ViewNode[]
}

export class Tabs extends ViewNode {
  readonly type = 'tabs' as const
  tabs: TabSpec[] = []
  active = ''
  constructor(props: BaseProps & { tabs: TabSpec[]; active?: string; onChange?: Handler }) {
    super()
    this.assign(props)
    if (!this.active && this.tabs.length) this.active = this.tabs[0].id
  }
  contentOf(id: string): ViewNode[] {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return []
    return Array.isArray(tab.content) ? tab.content : [tab.content]
  }
  nested(): ViewNode[] {
    return [...this.children, ...this.tabs.flatMap((t) => this.contentOf(t.id))]
  }
}

export class Setting extends ViewNode {
  readonly type = 'setting' as const
  name = ''
  desc?: string
  constructor(props: BaseProps & { name: string; desc?: string; children?: ViewNode[] }) {
    super()
    this.assign(props)
  }
}

// ── Content ──

export class Markdown extends ViewNode {
  readonly type = 'markdown' as const
  text = ''
  /** Render this note instead of `text`, and again whenever it changes. */
  file?: string
  /** What relative links in `text` resolve against. */
  filePath?: string
  constructor(
    arg:
      | string
      | (BaseProps & { text?: string; file?: string; filePath?: string; onClick?: Handler })
  ) {
    super()
    this.assign(typeof arg === 'string' ? { text: arg } : arg)
  }
}

export class Text extends ViewNode {
  readonly type = 'text' as const
  text = ''
  muted = false
  small = false
  constructor(
    arg: string | (BaseProps & { text: string; muted?: boolean; small?: boolean }),
    extra: BaseProps & { muted?: boolean; small?: boolean } = {}
  ) {
    super()
    this.assign(typeof arg === 'string' ? { text: arg, ...extra } : arg)
  }
}

export class Image extends ViewNode {
  readonly type = 'image' as const
  src = ''
  alt = ''
  fit: 'contain' | 'cover' | 'natural' = 'contain'
  constructor(
    props: BaseProps & { src: string; alt?: string; fit?: Image['fit']; onClick?: Handler }
  ) {
    super()
    this.assign(props)
  }
}

export interface TableColumn {
  key: string
  label: string
}
export type TableCell = string | ViewNode
export type TableRow = Record<string, TableCell>

export class Table extends ViewNode {
  readonly type = 'table' as const
  columns: TableColumn[] = []
  rows: TableRow[] = []
  constructor(
    props: BaseProps & {
      columns: Array<string | TableColumn>
      rows: Array<TableCell[] | TableRow>
      onRowClick?: Handler
    }
  ) {
    super()
    const { columns, rows, ...rest } = props
    this.columns = columns.map((c) => (typeof c === 'string' ? { key: c, label: c } : c))
    this.rows = rows.map((r) =>
      Array.isArray(r) ? Object.fromEntries(this.columns.map((c, i) => [c.key, r[i] ?? ''])) : r
    )
    this.assign(rest)
  }
  nested(): ViewNode[] {
    return [...this.children, ...this.rows.flatMap((r) => Object.values(r).filter(isNode))]
  }
}

export class Badge extends ViewNode {
  readonly type = 'badge' as const
  text = ''
  accent = false
  constructor(arg: string | (BaseProps & { text: string; accent?: boolean })) {
    super()
    this.assign(typeof arg === 'string' ? { text: arg } : arg)
  }
}

export class EmptyState extends ViewNode {
  readonly type = 'empty' as const
  text = ''
  constructor(arg: string | (BaseProps & { text: string })) {
    super()
    this.assign(typeof arg === 'string' ? { text: arg } : arg)
  }
}

// ── Controls ──

export class Button extends ViewNode {
  readonly type = 'button' as const
  text = ''
  icon?: string
  accent = false
  warning = false
  disabled = false
  tooltip?: string
  constructor(
    props: BaseProps & {
      text: string
      icon?: string
      accent?: boolean
      warning?: boolean
      disabled?: boolean
      tooltip?: string
      onClick?: Handler
    }
  ) {
    super()
    this.assign(props)
  }
  /** What a keyboard shortcut calls: the same handlers a press reaches. */
  click(): Promise<void> {
    return this.emit('click')
  }
}

export class Icon extends ViewNode {
  readonly type = 'icon' as const
  icon = ''
  tooltip = ''
  disabled = false
  constructor(
    props: BaseProps & { icon: string; tooltip: string; disabled?: boolean; onClick?: Handler }
  ) {
    super()
    this.assign(props)
  }
  click(): Promise<void> {
    return this.emit('click')
  }
}

export class Input extends ViewNode {
  readonly type = 'input' as const
  value = ''
  placeholder?: string
  textarea = false
  rows?: number
  disabled = false
  constructor(
    props: BaseProps & {
      value?: string
      placeholder?: string
      textarea?: boolean
      rows?: number
      disabled?: boolean
      onInput?: Handler
      onChange?: Handler
      onEnter?: Handler
    }
  ) {
    super()
    this.assign(props)
  }
}

export interface SelectOption {
  value: string
  label: string
}

export class Select extends ViewNode {
  readonly type = 'select' as const
  options: SelectOption[] = []
  value = ''
  constructor(
    props: BaseProps & { options: Array<string | SelectOption>; value?: string; onChange?: Handler }
  ) {
    super()
    const { options, ...rest } = props
    this.options = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
    this.assign(rest)
    if (!this.value && this.options.length) this.value = this.options[0].value
  }
}

export class Checkbox extends ViewNode {
  readonly type = 'checkbox' as const
  checked = false
  label?: string
  constructor(props: BaseProps & { checked?: boolean; label?: string; onChange?: Handler }) {
    super()
    this.assign(props)
  }
}

export class Search extends ViewNode {
  readonly type = 'search' as const
  value = ''
  placeholder?: string
  suggest?: 'file' | 'folder'
  constructor(
    props: BaseProps & {
      value?: string
      placeholder?: string
      suggest?: Search['suggest']
      onChange?: Handler
    }
  ) {
    super()
    this.assign(props)
  }
}

export class Card extends ViewNode {
  readonly type = 'card' as const
  title = ''
  subtitle?: string
  description?: string
  meta?: string[]
  badges: ViewNode[] = []
  actions: ViewNode[] = []
  selected?: boolean
  constructor(
    props: BaseProps & {
      title?: string
      subtitle?: string
      description?: string
      meta?: string[]
      badges?: ViewNode[]
      actions?: ViewNode[]
      children?: ViewNode[]
      selected?: boolean
      onClick?: Handler
    } = {}
  ) {
    super()
    this.assign(props)
  }
  nested(): ViewNode[] {
    return [...this.badges, ...this.actions, ...this.children]
  }
}

// ── Raw ──

export interface Delegate {
  event: string
  selector: string
  fn: Handler
}

export class Html extends ViewNode {
  readonly type = 'html' as const
  html = ''
  /** Kit nodes mounted inside the markup, by the selector of the element that holds each. */
  slots: Record<string, ViewNode> = {}
  /** `on: { 'click .x': fn }` — one listener per event on the root, matched by selector. */
  delegates: Delegate[] = []
  constructor(
    props: BaseProps & {
      html: string
      on?: Record<string, Handler>
      children?: Record<string, ViewNode>
      onMount?: Handler
    }
  ) {
    super()
    const { on, children, ...rest } = props
    this.assign(rest)
    if (children) this.slots = children
    for (const [spec, fn] of Object.entries(on ?? {})) {
      const [event, ...selector] = spec.trim().split(/\s+/)
      this.on(event, fn, selector.join(' '))
    }
  }
  /** With a selector the handler is delegated; without one it is an event on the root. */
  on(event: string, fn: Handler, selector?: string): this {
    if (selector) this.delegates.push({ event, selector, fn })
    else super.on(event, fn)
    return this
  }
  nested(): ViewNode[] {
    return [...this.children, ...Object.values(this.slots)]
  }
}

/** What the script prelude destructures. The docs test checks every name is documented. */
export const VIEW_GLOBALS = {
  Stack,
  Row,
  Grid,
  Section,
  Tabs,
  Setting,
  Markdown,
  Text,
  Image,
  Table,
  Badge,
  EmptyState,
  Button,
  Icon,
  Input,
  Select,
  Checkbox,
  Search,
  Card,
  Html,
}
