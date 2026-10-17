import { t } from '@/i18n'
import { Menu } from 'obsidian'
import { formatCoordinates, sortWords, type MapPlace, type MapSortFrom } from './places'

/**
 * The map's menus, Obsidian's own: on a mark (the note's usual ways to open, the card, the
 * coordinates, deleting), on the map itself (a new note here, the coordinates, the view's centre
 * and zoom), on a group that cannot be split, the backgrounds, and the list's order.
 */

type PlaceMenuActions = {
  open: (place: MapPlace, where: 'tab' | 'split' | 'window') => void
  card: (place: MapPlace) => void
  copy: (place: MapPlace) => void
  remove: (place: MapPlace) => void
}

export function placeMenu(place: MapPlace, actions: PlaceMenuActions, withCard = true): Menu {
  const menu = new Menu()
  menu.addItem((i) =>
    i
      .setTitle(t('maps.tab'))
      .setIcon('file-plus')
      .onClick(() => actions.open(place, 'tab'))
  )
  menu.addItem((i) =>
    i
      .setTitle(t('maps.split'))
      .setIcon('separator-vertical')
      .onClick(() => actions.open(place, 'split'))
  )
  menu.addItem((i) =>
    i
      .setTitle(t('maps.window'))
      .setIcon('picture-in-picture-2')
      .onClick(() => actions.open(place, 'window'))
  )
  menu.addSeparator()
  if (withCard)
    menu.addItem((i) =>
      i
        .setTitle(t('maps.card'))
        .setIcon('panel-top')
        .onClick(() => actions.card(place))
    )
  menu.addItem((i) =>
    i
      .setTitle(t('maps.copy'))
      .setIcon('copy')
      .onClick(() => actions.copy(place))
  )
  menu.addSeparator()
  menu.addItem((i) =>
    i
      .setTitle(t('maps.delete'))
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => actions.remove(place))
  )
  return menu
}

type MapMenuActions = {
  create: () => void
  copy: () => void
  centre: () => void
  zoom: () => void
}

export function mapMenu(lat: number, lon: number, zoom: number, actions: MapMenuActions): Menu {
  const menu = new Menu()
  menu.addItem((i) => i.setTitle(t('maps.newHere')).setIcon('map-pin-plus').onClick(actions.create))
  menu.addItem((i) =>
    i
      .setTitle(t('maps.copyValue', { value: formatCoordinates(lat, lon) }))
      .setIcon('copy')
      .onClick(actions.copy)
  )
  menu.addSeparator()
  menu.addItem((i) => i.setTitle(t('maps.setCenter')).setIcon('crosshair').onClick(actions.centre))
  menu.addItem((i) =>
    i
      .setTitle(t('maps.saveZoom', { value: Math.round(zoom * 10) / 10 }))
      .setIcon('zoom-in')
      .onClick(actions.zoom)
  )
  return menu
}

/** A group whose places share one spot: the places by name, each opening its card. */
export function spotMenu(places: MapPlace[], pick: (place: MapPlace) => void): Menu {
  const menu = new Menu()
  menu.addItem((i) => i.setTitle(t('maps.placesHere', { count: places.length })).setIsLabel(true))
  for (const place of places) {
    menu.addItem((i) =>
      i
        .setTitle(place.title)
        .setIcon(place.icon || 'map-pin')
        .onClick(() => pick(place))
    )
  }
  return menu
}

export function backgroundMenu(
  names: (string | { id: string; name: string })[],
  current: string,
  pick: (name: string) => void,
  manage: () => void
): Menu {
  const menu = new Menu()
  for (const entry of names) {
    const id = typeof entry === 'string' ? entry : entry.id
    const name = typeof entry === 'string' ? entry : entry.name
    menu.addItem((i) =>
      i
        .setTitle(name)
        .setChecked(id === current)
        .onClick(() => pick(id))
    )
  }
  menu.addSeparator()
  menu.addItem((i) => i.setTitle(t('maps.manage')).setIcon('settings').onClick(manage))
  return menu
}

export function sortMenu(
  current: MapSortFrom,
  canLocate: boolean,
  pick: (from: MapSortFrom) => void
): Menu {
  const menu = new Menu()
  for (const from of ['base', 'me', 'centre'] as MapSortFrom[]) {
    menu.addItem((i) => {
      i.setTitle(sortWords[from]).setChecked(from === current)
      if (from === 'me' && !canLocate) i.setDisabled(true)
      i.onClick(() => pick(from))
    })
  }
  return menu
}
