import { t } from './index'
import { english } from './catalogs'
import type { MessageKey } from './types'

const metadata = new Map<string, MessageKey>(
  Object.entries(english)
    .filter(([, value]) => typeof value === 'string' && !value.includes('{'))
    .map(([key, value]) => [value as string, key as MessageKey])
)

/** Only plugin-authored control metadata enters here, never document text or identifiers. */
export function streamCUI(text: string): string {
  const key = metadata.get(text)
  return key ? (t as (key: MessageKey) => string)(key) : text
}
// Only known color, width and shape IDs enter this display projection.
const labels = {
  red: 'streamC.b1f51a511f1da0cd',
  orange: 'streamC.1b4c9133da73a711',
  yellow: 'streamC.c685a2c9bab235cc',
  green: 'streamC.ba4788b226aa8dc2',
  cyan: 'streamC.3057b5dce3050113',
  purple: 'streamC.8e0a1b0ada421728',
  blue: 'streamC.16477688c0e00699',
  pink: 'streamC.a67a41c8bc79d5da',
  black: 'streamC.c006c7e3ab14d686',
  white: 'streamC.018fa96a44715c90',
  fine: 'streamC.d14a58bae804a2b8',
  medium: 'streamC.c082456a7766e23a',
  bold: 'streamC.e0007a5bca8d9158',
  rectangle: 'streamC.32dfed947e8bca93',
  pill: 'streamC.e3127a4ce13edc51',
  diamond: 'streamC.81c9d6128b5fcd7b',
  parallelogram: 'streamC.078f743dc664d4e1',
  circle: 'streamC.8a39178d327e72a9',
  'predefined process': 'streamC.f2c02185b8b78390',
  document: 'streamC.43cc23fa52b87b4c',
  database: 'streamC.3549b0028b75d981',
} as const
export function streamCLabel(value: string): string {
  const key = labels[value.replace(/-/g, ' ') as keyof typeof labels]
  return key ? t(key) : value
}
export function streamCTitle(value: string): string {
  const label = streamCLabel(value)
  return label[0].toUpperCase() + label.slice(1)
}
