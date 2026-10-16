/**
 * The map's looks a person picks from in the settings: the free OpenFreeMap styles, one that
 * follows the theme (bright by day, dark by night), and a MapLibre style of one's own by URL.
 */
export type MapStyleChoice =
  | 'theme'
  | 'liberty'
  | 'bright'
  | 'positron'
  | 'dark'
  | 'fiord'
  | 'custom'

const FREE = 'https://tiles.openfreemap.org/styles/'

export const MAP_STYLES: { value: MapStyleChoice; display: string }[] = [
  { value: 'theme', display: 'Follows the theme' },
  { value: 'liberty', display: 'Liberty' },
  { value: 'bright', display: 'Bright' },
  { value: 'positron', display: 'Positron, quiet' },
  { value: 'dark', display: 'Dark' },
  { value: 'fiord', display: 'Fiord, dark blue' },
  { value: 'custom', display: 'Own style by URL' },
]

/**
 * The style a map is drawn in. A settings file from before the choice existed that holds a URL
 * means that URL; an own style with no URL yet falls back to following the theme.
 */
export function mapStyleUrl(
  choice: MapStyleChoice | undefined,
  ownUrl: string,
  dark: boolean
): string {
  const picked = choice ?? (ownUrl ? 'custom' : 'theme')
  if (picked === 'custom' && ownUrl) return ownUrl
  if (picked === 'theme' || picked === 'custom') return `${FREE}${dark ? 'dark' : 'bright'}`
  return `${FREE}${picked}`
}
