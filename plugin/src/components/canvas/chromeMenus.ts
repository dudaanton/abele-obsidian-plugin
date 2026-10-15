/**
 * The canvas's menus, each opened at the button that was pressed: the colour, shape, line and
 * arrow pickers over a picked thing, its "more" menu, what to make at a loose connection's end,
 * what to do with work that did not save, and the tab's own "more" items.
 */
import { Menu, Notice, Platform } from 'obsidian'
import type { CanvasEditor } from '@/canvas/Editor'
import type { CanvasNode, Rect } from '@/canvas/core/model'
import { partRegion, type CanvasHostActions } from '@/canvas/pickedActions'
import { SHAPES } from '@/canvas/core/model'
import { COLOURS, COLOUR_NAMES, ROUTE_ICONS, SHAPE_ICONS } from './chromeTools'

type Controls = CanvasEditor['controls']
/** What is picked, as the menus over it need to know it. */
export interface PickedView {
  ids: string[]
  kinds: string[]
  one: boolean
  kind: string
  node: CanvasNode | undefined
  shape: string
  colour: string
  /** Around all of it, in the canvas's own units. */
  rect: Rect | null
}

/** A menu opens at the button that was pressed, under it, or over it at the foot. */
export function showAt(menu: Menu, e: MouseEvent): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const low = r.top > window.innerHeight / 2
  menu.showAtPosition({
    x: r.left,
    y: low ? r.top : r.bottom,
    left: false,
    overlap: false,
    width: r.width,
  })
}

/** Something the menu offers that the prototype does not do yet: it says so and does nothing. */
const later = (title: string) => (): void =>
  void new Notice(`${title.replace(/…$/, '')}: not in this prototype yet`)

export function colourMenu(e: MouseEvent, c: Controls, p: PickedView): void {
  const menu = new Menu()
  for (const v of COLOURS)
    menu.addItem((item) =>
      item
        .setTitle(v ? COLOUR_NAMES[v][0].toUpperCase() + COLOUR_NAMES[v].slice(1) : 'No colour')
        .setIcon('circle')
        .setChecked(p.colour === v)
        .onClick(() => applyColour(v, c, p))
    )
  showAt(menu, e)
}
function applyColour(v: string, c: Controls, p: PickedView): void {
  if (p.kind === 'connection' || p.kind === 'line') {
    c.set('connection-color', v)
    return c.press('Apply connection style')
  }
  if (p.one && (p.kind === 'text' || p.kind === 'shape')) {
    c.set('shape-color', v)
    c.set('shape', p.shape)
    return c.press('Apply selected shape')
  }
  c.set('ink-color', v)
  c.press('Recolor canvas selection')
}
export function shapeMenu(e: MouseEvent, c: Controls, p: PickedView): void {
  const menu = new Menu()
  for (const s of SHAPES)
    menu.addItem((item) =>
      item
        .setTitle(s[0].toUpperCase() + s.slice(1).replace(/-/g, ' '))
        .setIcon(SHAPE_ICONS[s] ?? 'square')
        .setChecked(p.shape === s)
        .onClick(() => {
          c.set('shape', s)
          c.set('shape-color', p.colour)
          c.press('Apply selected shape')
        })
    )
  showAt(menu, e)
}
export function routeMenu(e: MouseEvent, c: Controls): void {
  const menu = new Menu()
  for (const [v, title] of [
    ['direct', 'Straight'],
    ['square', 'Elbow'],
    ['bezier', 'Curved'],
  ])
    menu.addItem((item) =>
      item
        .setTitle(title)
        .setIcon(ROUTE_ICONS[v])
        .setChecked(c.value('routing') === v)
        .onClick(() => {
          c.set('routing', v)
          c.press('Apply connection style')
        })
    )
  showAt(menu, e)
}
export function endsMenu(e: MouseEvent, c: Controls): void {
  const menu = new Menu()
  for (const [from, to, title, icon] of [
    ['none', 'arrow', 'Arrow at the end', 'move-right'],
    ['arrow', 'arrow', 'Arrows at both ends', 'move-horizontal'],
    ['none', 'none', 'No arrows', 'minus'],
  ])
    menu.addItem((item) =>
      item
        .setTitle(title)
        .setIcon(icon)
        .setChecked(c.value('from-end') === from && c.value('to-end') === to)
        .onClick(() => {
          c.set('from-end', from)
          c.set('to-end', to)
          c.press('Apply connection style')
        })
    )
  showAt(menu, e)
}

type Entry = { title: string; icon: string; run: () => unknown; warning?: boolean } | '-'

/**
 * The picked things' "more" menu. Every kind gets the same order of sections: copies, stacking,
 * what turns it into something else, the agent, taking it out of the canvas as a picture or an
 * embed, and last, apart and in red, what removes it.
 */
export function moreEntries(c: Controls, p: PickedView, host?: CanvasHostActions): Entry[] {
  const remove = () =>
    c.press(
      c.state('Delete selected card').disabled ? 'Delete canvas selection' : 'Delete selected card'
    )
  const kinds = new Set(p.kinds)
  const strokes = [...kinds].every((k) => k === 'stroke')
  const lines = [...kinds].every((k) => k === 'connection' || k === 'line')
  const frame = p.one && p.kind === 'group'
  const card = (k: string) => k === 'text' || k === 'shape' || k === 'file' || k === 'link'
  const entry = (title: string, icon: string, run: () => unknown, warning = false): Entry => ({
    title,
    icon,
    run,
    warning,
  })
  /** What goes to the host, or, without one, a word that it is not here. */
  const outside = (title: string, run: (h: CanvasHostActions, region: Rect) => unknown) =>
    host && p.rect ? () => run(host, partRegion(p.rect)) : later(title)
  const agent: Entry[] = [
    entry(
      'Attach to the chat as a picture',
      'paperclip',
      outside('Attach to the chat as a picture', (h, region) => h.attach(region))
    ),
    entry(
      'Ask the agent about this',
      'message-circle-question',
      outside('Ask the agent about this', (h, region) => h.ask(region, p.ids, 'ask'))
    ),
  ]
  if (lines)
    return [
      ...(p.one ? [entry('Edit label', 'text-cursor-input', () => c.editLabel(p.ids[0]))] : []),
      entry('Bring to front', 'bring-to-front', () => c.act('front')),
      entry('Send to back', 'send-to-back', () => c.act('back')),
      '-',
      entry('Delete', 'trash-2', remove, true),
    ]
  if (frame)
    return [
      entry('Duplicate with what is inside', 'copy-plus', () => c.act('duplicate')),
      entry('Copy', 'copy', () => c.act('copy')),
      '-',
      ...agent,
      '-',
      entry(
        'Export frame…',
        'image-down',
        outside('Export frame', (h, region) => h.exportPart(region, p.node?.label || 'frame'))
      ),
      entry(
        'Copy embed of this frame',
        'clipboard-copy',
        host ? () => host.copyEmbed({ node: p.ids[0] }) : later('Copy embed of this frame')
      ),
      '-',
      entry(
        'Delete frame and what is inside',
        'trash-2',
        () => c.act('delete-with-contents'),
        true
      ),
    ]
  const out: Entry[] = []
  if (strokes)
    out.push(
      entry(
        'Read the handwriting',
        'scan-text',
        outside('Read the handwriting', (h, region) => h.ask(region, p.ids, 'transcribe'))
      )
    )
  else
    out.push(
      entry('Duplicate', 'copy-plus', () => c.act('duplicate')),
      entry('Copy', 'copy', () => c.act('copy')),
      '-',
      entry('Bring to front', 'bring-to-front', () => c.act('front')),
      entry('Send to back', 'send-to-back', () => c.act('back'))
    )
  // A card pinned in place is picked, but stays where it was put until it is let go.
  if (p.one && card(p.kind)) {
    const pinned = p.node?.abele?.pinned === true
    out.push(
      entry(pinned ? 'Unpin' : 'Pin in place', pinned ? 'pin-off' : 'pin', () =>
        c.setPinned(p.ids[0], !pinned)
      )
    )
  }
  const note = p.one && p.kind === 'file' && /\.md$/i.test(p.node?.file ?? '') ? p.node?.file : null
  if (note && host)
    out.push(
      '-',
      entry('Show a part of the note…', 'heading', async () => {
        const part = await host.pickPart(note)
        if (part !== null) await c.setSubpath(p.ids[0], part)
      })
    )
  if (p.one && p.kind === 'text')
    out.push(
      '-',
      entry('Turn into a note', 'file-plus-2', () => c.act('turn-into-note'))
    )
  out.push('-', ...agent, '-')
  out.push(
    entry(
      'Export the selection…',
      'image-down',
      outside('Export the selection', (h, region) => h.exportPart(region, 'selection'))
    ),
    entry(
      'Copy embed of the selection',
      'clipboard-copy',
      outside('Copy embed of the selection', (h, region) => h.copyEmbed({ region }))
    ),
    '-'
  )
  // A note or a web page on the canvas only stands there: taking it off leaves the file alone.
  if (p.one && (p.kind === 'file' || p.kind === 'link')) {
    out.push(entry('Remove from canvas', 'square-x', remove, p.kind === 'link'))
    const file = p.node?.file
    if (p.kind === 'file')
      out.push(
        entry(
          'Delete the note…',
          'trash-2',
          host && file
            ? async () => {
                if (await host.trashNote(file)) remove()
              }
            : later('Delete the note'),
          true
        )
      )
  } else if ([...kinds].some(card) && [...kinds].some((k) => k === 'file'))
    out.push(entry('Remove from canvas', 'trash-2', remove, true))
  else out.push(entry('Delete', 'trash-2', remove, true))
  return out
}
/**
 * Which part of a note its card shows: the whole note or a part from one of its headings on;
 * each part can also be put beside it as a card of its own.
 */
export async function partMenu(
  e: MouseEvent | { currentTarget: EventTarget | null },
  c: Controls,
  p: PickedView,
  adding = false
): Promise<void> {
  const button = e.currentTarget as HTMLElement
  const node = p.node
  if (!node?.file) return
  const headings = await c.headings(node.file)
  const menu = new Menu()
  const current = node.subpath ?? ''
  const run = (subpath: string): void =>
    void (adding ? c.addPart(node.id, subpath) : c.showPart(node.id, subpath))
  if (!adding)
    menu.addItem((item) =>
      item
        .setTitle('The whole note')
        .setIcon('file-text')
        .setChecked(!current)
        .onClick(() => run(''))
    )
  if (headings.length && !adding) menu.addSeparator()
  const top = Math.min(...headings.map((h) => h.level))
  for (const h of headings)
    menu.addItem((item) =>
      item
        .setTitle(`${'\u2003'.repeat(h.level - top)}${h.heading}`)
        .setIcon(adding ? 'copy-plus' : 'heading')
        .setChecked(!adding && current === `#${h.heading}`)
        .onClick(() => run(`#${h.heading}`))
    )
  if (!headings.length)
    menu.addItem((item) => item.setTitle('This note has no headings').setDisabled(true))
  else if (!adding) {
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle('Add a part beside it…')
        .setIcon('copy-plus')
        .onClick(() => void partMenu({ currentTarget: button }, c, p, true))
    )
  }
  const r = button.getBoundingClientRect()
  menu.showAtPosition({ x: r.left, y: r.bottom, left: false, overlap: false, width: r.width })
}
export function moreMenu(
  e: MouseEvent,
  c: Controls,
  p: PickedView,
  host?: CanvasHostActions
): void {
  const menu = new Menu()
  for (const x of moreEntries(c, p, host)) {
    if (x === '-') menu.addSeparator()
    else
      menu.addItem((item) =>
        item
          .setTitle(x.title)
          .setIcon(x.icon)
          .setWarning(!!x.warning)
          .onClick(() => void x.run())
      )
  }
  showAt(menu, e)
}

/**
 * A connection let go over nothing: a menu where it was let go, to make there a card, a note or
 * the shape last used, joined to it. Closed without a choice, nothing is made.
 */
export function dropMenu(c: Controls): void {
  const drop = c.drop()
  if (!drop) return
  let chosen = false
  const menu = new Menu()
  const add = (title: string, icon: string, kind: 'card' | 'note' | 'shape') =>
    menu.addItem((item) =>
      item
        .setTitle(title)
        .setIcon(icon)
        .onClick(() => {
          chosen = true
          void c.dropAdd(kind)
        })
    )
  add('Card', 'sticky-note', 'card')
  add('Note or file', 'file-text', 'note')
  const shape = c.value('shape') || 'rectangle'
  add(`Shape: ${shape.replace(/-/g, ' ')}`, SHAPE_ICONS[shape] ?? 'square', 'shape')
  menu.onHide(() => {
    if (!chosen) void c.dropAdd(null)
  })
  menu.showAtPosition({ x: drop.screen.x, y: drop.screen.y })
}

export function saveMenu(e: MouseEvent, c: Controls): void {
  const menu = new Menu()
  menu.addItem((i) =>
    i
      .setTitle('Retry')
      .setIcon('refresh-cw')
      .onClick(() => c.press('Retry save'))
  )
  menu.addItem((i) =>
    i
      .setTitle('Discard the draft…')
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => c.press('Discard local draft'))
  )
  showAt(menu, e)
}

/**
 * The canvas tab's own "more" items, at the top of Obsidian's pane menu, as a view's onPaneMenu
 * adds them. Attaching to the chat is a glyph in the tab's header, so it is not repeated here.
 */
export function paneEntries(
  handlers: {
    exportCanvas: () => unknown
    copyEmbed: () => unknown
    find: () => unknown
    contents: () => unknown
    openNative: () => unknown
    fingerDraws?: { on: boolean; toggle: () => unknown }
  },
  tablet = Platform.isTablet
): { title: string; icon: string; run: () => unknown; checked?: boolean }[] {
  return [
    { title: 'Find on the canvas', icon: 'search', run: handlers.find },
    { title: 'Show contents', icon: 'list', run: handlers.contents },
    { title: 'Export…', icon: 'image-down', run: handlers.exportCanvas },
    { title: 'Copy embed of what is shown', icon: 'clipboard-copy', run: handlers.copyEmbed },
    { title: 'Open in Obsidian Canvas', icon: 'layout-dashboard', run: handlers.openNative },
    // Only where a pen and fingers share the screen: whether a finger draws as well.
    ...(handlers.fingerDraws && tablet
      ? [
          {
            title: 'Draw with a finger',
            icon: 'pointer',
            run: handlers.fingerDraws.toggle,
            checked: handlers.fingerDraws.on,
          },
        ]
      : []),
  ]
}
