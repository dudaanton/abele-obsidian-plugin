import { t } from './index'
import { agentText } from './streamBText'
import { streamBLabel } from './streamBLabels'
import type { MessageKey, Params } from './types'
import type { Refusal } from '@/github/refusal'

type Value = string | number | UiMessage
export interface KeyMessage {
  readonly key: MessageKey
  readonly params: Readonly<Record<string, Value>>
}
export type UiMessage = KeyMessage | { readonly original: string; readonly localized: () => string }
type UiParams<K extends MessageKey> = { [P in keyof Params<K>]: Params<K>[P] | UiMessage }
type UiArgs<K extends MessageKey> = keyof Params<K> extends never ? [] : [params: UiParams<K>]
export function uiMessage<K extends MessageKey>(key: K, ...args: UiArgs<K>): UiMessage {
  return { key, params: args[0] ?? {} }
}
const fields = Symbol('presentation messages')
type FieldMessages = Readonly<Record<string, UiMessage | undefined>>
type Presented = { [fields]?: FieldMessages }
const translator = t as (key: MessageKey, params: Record<string, string | number>) => string
const english = agentText as (key: MessageKey, params: Record<string, string | number>) => string
function render(message: UiMessage, localized: boolean): string {
  if ('original' in message) return localized ? message.localized() : message.original
  const params = Object.fromEntries(
    Object.entries(message.params).map(([key, value]) => [
      key,
      typeof value === 'object' ? render(value, localized) : value,
    ])
  )
  return (localized ? translator : english)(message.key, params)
}
/** Presentation metadata stays outside enumerable and serialized domain fields. */
export function uiFields<T extends object>(record: T, messages: FieldMessages, source?: object): T {
  Object.defineProperty(record, fields, {
    value: {
      ...(source as Presented | undefined)?.[fields],
      ...(record as Presented)[fields],
      ...messages,
    },
    enumerable: false,
    configurable: true,
  })
  return record
}
export function uiField<T extends object, K extends keyof T>(
  record: T,
  field: K,
  message: UiMessage | undefined
): T[K] {
  uiFields(record, { [String(field)]: message })
  record[field] = (message ? render(message, false) : undefined) as T[K]
  return record[field]
}
export function copyUiField<T extends object, K extends keyof T>(
  source: object,
  from: string,
  target: T,
  to: K
): T[K] {
  uiFields(target, { [String(to)]: (source as Presented)[fields]?.[from] })
  target[to] = (source as Record<string, unknown>)[from] as T[K]
  return target[to]
}
export class UiError extends Error {
  constructor(message: UiMessage) {
    super(render(message, false))
    uiFields(this, { message })
  }
}
export function presentUiField(record: object, field: string): string {
  const original = (record as Record<string, unknown>)[field]
  if (original === undefined || original === null || original === '') return ''
  const message = (record as Presented)[fields]?.[field]
  return message ? render(message, true) : String((record as Record<string, unknown>)[field] ?? '')
}
const permissionText = (value: string) =>
  value.replace(/Metadata|Contents|Pull requests|Discussions|Issues/g, streamBLabel)
/** Only explicit presentation metadata is translated. Provider messages remain verbatim. */
export function presentUiError(error: unknown): string {
  if (error === null || error === undefined) return ''
  const refusal =
    typeof error === 'object' && 'refusal' in error ? (error.refusal as Refusal) : undefined
  if (!refusal || typeof refusal.reason !== 'string') {
    return error instanceof Error ? presentUiField(error, 'message') : String(error)
  }
  const lines = [
    presentUiField(refusal, 'reason') + (refusal.fix ? ' ' + presentUiField(refusal, 'fix') : ''),
  ]
  if (refusal.needed)
    lines.push(t('streamBError.65aab2aa1d', { v0: permissionText(refusal.needed) }))
  if (refusal.githubSaid) lines.push(t('streamBError.5247198e11', { v0: refusal.githubSaid }))
  if (refusal.graphql) lines.push(presentUiField(refusal, 'graphql'))
  return lines.join('\n')
}

export const uiFieldMessage = (record: object, field: string): UiMessage => ({
  original: String((record as Record<string, unknown>)[field] ?? ''),
  localized: () => presentUiField(record, field),
})
export const uiErrorMessage = (error: unknown): UiMessage => ({
  original: error instanceof Error ? error.message : String(error ?? ''),
  localized: () => presentUiError(error),
})

export function redactUiFields<T extends object>(record: T, redact: (value: string) => string): T {
  const safe = Object.fromEntries(
    Object.entries((record as Presented)[fields] ?? {}).map(([key, message]) => [
      key,
      message
        ? {
            original: redact(render(message, false)),
            localized: () => redact(render(message, true)),
          }
        : undefined,
    ])
  )
  return uiFields(record, safe)
}
export const uiJoin = (messages: readonly UiMessage[], separator: string): UiMessage => ({
  original: messages.map((message) => render(message, false)).join(separator),
  localized: () => messages.map((message) => render(message, true)).join(separator),
})
export const presentUiMessage = (message: UiMessage): string => render(message, true)
