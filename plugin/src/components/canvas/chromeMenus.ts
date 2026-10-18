import { streamCLabel } from '@/i18n/streamCLabels'
import { t } from '@/i18n'
import { canvasMenu } from '@/canvas/menu'
/**
 * The canvas's menus, each opened at the button that was pressed: the colour, shape, line and
 * arrow pickers over a picked thing, its "more" menu, what to make at a loose connection's end,
 * what to do with work that did not save, and the tab's own "more" items.
 */
import { Notice, Platform, type Menu } from 'obsidian'
import type { CanvasEditor } from '@/canvas/Editor'
import type { CanvasNode, Rect } from '@/canvas/core/model'
import { partRegion, type CanvasHostActions } from '@/canvas/pickedActions'
import { SHAPES } from '@/canvas/core/model'
import { COLOURS, COLOUR_NAMES, ROUTE_ICONS, SHAPE_ICONS } from './chromeTools'
import { panelsShown } from '@/canvas/cardPanels'

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
  void new Notice(t('streamC.2cc3e53edd691439', { v1: String(title.replace(/…$/, '')) }))

export function colourMenu(e: MouseEvent, c: Controls, p: PickedView): void {
  const menu = canvasMenu()
  for (const v of COLOURS)
    menu.addItem((item) =>
      item
        .setTitle(
          v ? COLOUR_NAMES[v][0].toUpperCase() + COLOUR_NAMES[v].slice(1) : t('kit.noColour')
        )
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
  const menu = canvasMenu()
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
  const menu = canvasMenu()
  for (const [v, title] of [
    ['direct', t('streamC.dc81306b118237b3')],
    ['square', t('streamC.45bd315f03db1ca0')],
    ['bezier', t('streamC.c6d7ba0973c76108')],
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
  const menu = canvasMenu()
  for (const [from, to, title, icon] of [
    ['none', 'arrow', t('streamC.0fdc8654a8591c28'), 'move-right'],
    ['arrow', 'arrow', t('streamC.0405761e7bee47ab'), 'move-horizontal'],
    ['none', 'none', t('streamC.c3fd1e1d6aed3a8e'), 'minus'],
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

type Entry =
  | { title: string; icon: string; run: () => unknown; warning?: boolean; checked?: boolean }
  | '-'

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
      t('streamC.2622d0434f9aee70'),
      'paperclip',
      outside(t('streamC.2622d0434f9aee70'), (h, region) => h.attach(region))
    ),
    entry(
      t('streamC.8468e3f2b43168ab'),
      'message-circle-question',
      outside(t('streamC.8468e3f2b43168ab'), (h, region) => h.ask(region, p.ids, 'ask'))
    ),
  ]
  if (lines)
    return [
      ...(p.one
        ? [entry(t('streamC.6756cc16dcfbe296'), 'text-cursor-input', () => c.editLabel(p.ids[0]))]
        : []),
      entry(t('streamC.520cdb7e46095a83'), 'bring-to-front', () => c.act('front')),
      entry(t('streamC.e3daa79eaf6975f8'), 'send-to-back', () => c.act('back')),
      '-',
      entry(t('kit.delete'), 'trash-2', remove, true),
    ]
  if (frame)
    return [
      entry(t('streamC.eb9c27996c5d854d'), 'copy-plus', () => c.act('duplicate')),
      entry(t('streamC.e21f935f11d7e966'), 'copy', () => c.act('copy')),
      '-',
      ...agent,
      '-',
      entry(
        t('streamC.85ba11aa00473464'),
        'image-down',
        outside(t('streamC.2300e13ca595077b'), (h, region) =>
          h.exportPart(region, p.node?.label || 'frame')
        )
      ),
      entry(
        t('streamC.08e56c14a098f63c'),
        'clipboard-copy',
        host ? () => host.copyEmbed({ node: p.ids[0] }) : later(t('streamC.08e56c14a098f63c'))
      ),
      '-',
      entry(t('streamC.0962ea885f061eb7'), 'trash-2', () => c.act('delete-with-contents'), true),
    ]
  const out: Entry[] = []
  if (strokes)
    out.push(
      entry(
        t('streamC.ca5d587094939bbe'),
        'scan-text',
        outside(t('streamC.ca5d587094939bbe'), (h, region) => h.ask(region, p.ids, 'transcribe'))
      )
    )
  else
    out.push(
      entry(t('streamC.02cdaabfca805d6a'), 'copy-plus', () => c.act('duplicate')),
      entry(t('streamC.e21f935f11d7e966'), 'copy', () => c.act('copy')),
      '-',
      entry(t('streamC.520cdb7e46095a83'), 'bring-to-front', () => c.act('front')),
      entry(t('streamC.e3daa79eaf6975f8'), 'send-to-back', () => c.act('back'))
    )
  // A card pinned in place is picked, but stays where it was put until it is let go.
  if (p.one && card(p.kind)) {
    const pinned = p.node?.abele?.pinned === true
    out.push(
      entry(
        pinned ? t('streamC.ee3c716130546a45') : t('streamC.a4fbdeab16123f9e'),
        pinned ? 'pin-off' : 'pin',
        () => c.setPinned(p.ids[0], !pinned)
      )
    )
  }
  const note = p.one && p.kind === 'file' && /\.md$/i.test(p.node?.file ?? '') ? p.node?.file : null
  if (note && host)
    out.push(
      '-',
      entry(t('streamC.d0b8584431f3a0bd'), 'heading', async () => {
        const part = await host.pickPart(note)
        if (part !== null) await c.setSubpath(p.ids[0], part)
      })
    )
  // Abele's header and footer inside the card, as a tab shows them; ticked when the card shows them.
  if (note && p.node) {
    const shown = panelsShown(p.node, c.notePanels())
    out.push({
      title: t('streamC.4dc703cdd6332d19'),
      icon: 'panel-bottom',
      run: () => c.setPanels(p.ids[0], !shown),
      checked: shown,
    })
  }
  if (p.one && p.kind === 'text')
    out.push(
      '-',
      entry(t('streamC.9dd6dca01d41eb19'), 'file-plus-2', () => c.act('turn-into-note'))
    )
  out.push('-', ...agent, '-')
  out.push(
    entry(
      t('streamC.27d52c2092812848'),
      'image-down',
      outside(t('streamC.541a81f2c443195c'), (h, region) => h.exportPart(region, 'selection'))
    ),
    entry(
      t('streamC.5245e0f78016ee93'),
      'clipboard-copy',
      outside(t('streamC.5245e0f78016ee93'), (h, region) => h.copyEmbed({ region }))
    ),
    '-'
  )
  // A note or a web page on the canvas only stands there: taking it off leaves the file alone.
  if (p.one && (p.kind === 'file' || p.kind === 'link')) {
    out.push(entry(t('streamC.3e4656c48e2a2332'), 'square-x', remove, p.kind === 'link'))
    const file = p.node?.file
    if (p.kind === 'file')
      out.push(
        entry(
          t('streamC.1927802a36b4bc71'),
          'trash-2',
          host && file
            ? async () => {
                if (await host.trashNote(file)) remove()
              }
            : later(t('streamC.d944888c54407d3f')),
          true
        )
      )
  } else if ([...kinds].some(card) && [...kinds].some((k) => k === 'file'))
    out.push(entry(t('streamC.3e4656c48e2a2332'), 'trash-2', remove, true))
  else out.push(entry(t('kit.delete'), 'trash-2', remove, true))
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
  const menu = canvasMenu()
  const current = node.subpath ?? ''
  const run = (subpath: string): void =>
    void (adding ? c.addPart(node.id, subpath) : c.showPart(node.id, subpath))
  if (!adding)
    menu.addItem((item) =>
      item
        .setTitle(t('streamC.c856e661b969b9ab'))
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
    menu.addItem((item) => item.setTitle(t('streamC.6b7d02a03f897892')).setDisabled(true))
  else if (!adding) {
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle(t('streamC.0a1357518c2ebb29'))
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
  const menu = canvasMenu()
  for (const x of moreEntries(c, p, host)) {
    if (x === '-') menu.addSeparator()
    else
      menu.addItem((item) =>
        item
          .setTitle(x.title)
          .setIcon(x.icon)
          .setWarning(!!x.warning)
          .setChecked(x.checked ?? null)
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
  const menu = canvasMenu(() => {
    if (!chosen) void c.dropAdd(null)
  })
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
  add(t('streamC.be3702e3f1af559a'), 'sticky-note', 'card')
  add(t('streamC.6d1df671bca39f2c'), 'file-text', 'note')
  const shape = c.value('shape') || 'rectangle'
  add(
    t('streamC.e45def34712fa10c', { v1: streamCLabel(shape.replace(/-/g, ' ')) }),
    SHAPE_ICONS[shape] ?? 'square',
    'shape'
  )
  menu.showAtPosition({ x: drop.screen.x, y: drop.screen.y })
}

export function saveMenu(e: MouseEvent, c: Controls): void {
  const menu = canvasMenu()
  menu.addItem((i) =>
    i
      .setTitle(t('streamC.942087cc2d41e013'))
      .setIcon('refresh-cw')
      .onClick(() => c.press('Retry save'))
  )
  menu.addItem((i) =>
    i
      .setTitle(t('streamC.ced2119ede415de6'))
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
    /** Whether the canvas's notes show Abele's header and footer unless a card says otherwise. */
    notePanels?: { on: boolean; toggle: () => unknown }
  },
  tablet = Platform.isTablet
): { title: string; icon: string; run: () => unknown; checked?: boolean }[] {
  return [
    { title: t('streamC.c884c0baeb3d433c'), icon: 'search', run: handlers.find },
    { title: t('streamC.f2f3ecf5f5992e7b'), icon: 'list', run: handlers.contents },
    { title: t('streamC.4a4c59c5208e8a7d'), icon: 'image-down', run: handlers.exportCanvas },
    { title: t('streamC.1b815249fa4a87df'), icon: 'clipboard-copy', run: handlers.copyEmbed },
    { title: t('streamC.758a503bd4ae4622'), icon: 'layout-dashboard', run: handlers.openNative },
    ...(handlers.notePanels
      ? [
          {
            title: t('streamC.dcf9f5e8ec791fb7'),
            icon: 'panel-bottom',
            run: handlers.notePanels.toggle,
            checked: handlers.notePanels.on,
          },
        ]
      : []),
    // Only where a pen and fingers share the screen: whether a finger draws as well.
    ...(handlers.fingerDraws && tablet
      ? [
          {
            title: t('streamC.417306cf41cba485'),
            icon: 'pointer',
            run: handlers.fingerDraws.toggle,
            checked: handlers.fingerDraws.on,
          },
        ]
      : []),
  ]
}
