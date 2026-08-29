/** What a settings transfer is made of, shared by the side that sends and the side that reads. */

/** The groups the sending screen offers, in the order it offers them. */
export const TRANSFER_SECTIONS = [
  'ai-general',
  'ai-providers',
  'ai-image-providers',
  'ai-agents',
  'ai-interceptors',
  'ai-secrets',
  'ai-prompts',
  'scripts',
  'links',
  'header-buttons',
  'journals',
  'tasks',
  'finance',
  'time-tracking',
  'other',
] as const

export type SectionId = (typeof TRANSFER_SECTIONS)[number]

/**
 * One thing that can travel on its own: a provider, an agent, a link — or a whole block of
 * settings that has no parts worth choosing between, like the finance folders.
 *
 * Everything is an entry, including the blocks, so that both screens have one list to show
 * and one checkbox to offer, rather than a special case per section.
 */
export interface TransferEntry {
  section: SectionId
  /** Stable within its section: what the other side matches against to know a replacement. */
  id: string
  label: string
  data: unknown
  /** Keychain ids whose values ride along, when keys are being sent. */
  secretIds?: string[]
  /** The entry's own data holds a credential, which is what forces the whole transfer shut. */
  sensitive?: boolean
}

export interface TransferPayload {
  v: 1
  /** When it was made, shown on the receiving side so an old QR is recognisable as old. */
  at: string
  entries: TransferEntry[]
  /** Keychain id to value, for the entries that asked for them. */
  secrets: Record<string, string>
}
