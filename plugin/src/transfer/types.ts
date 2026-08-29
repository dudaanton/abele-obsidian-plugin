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
  'script-files',
  'skill-notes',
  'prompt-notes',
  'links',
  'header-buttons',
  'journals',
  'tasks',
  'finance',
  'time-tracking',
  'other',
] as const

export type SectionId = (typeof TRANSFER_SECTIONS)[number]

/** The sections whose entries are files in the vault rather than settings. */
export const FILE_SECTIONS = ['script-files', 'skill-notes', 'prompt-notes'] as const

export const FILE_SECTION_LABELS: Record<(typeof FILE_SECTIONS)[number], string> = {
  'script-files': 'Scripts',
  'skill-notes': 'Skills',
  'prompt-notes': 'Prompt notes',
}

export const isFileSection = (section: SectionId): boolean =>
  (FILE_SECTIONS as readonly string[]).includes(section)

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

/**
 * A file travelling whole: a script, a skill, a prompt.
 *
 * `base` is the folder a script came out of, kept only so a vault with no scripts folder of
 * its own has somewhere to put it.
 */
export interface TransferFile {
  path: string
  content: string
  base?: string
}

export interface TransferPayload {
  v: 1
  /** When it was made, shown on the receiving side so an old QR is recognisable as old. */
  at: string
  entries: TransferEntry[]
  /** Keychain id to value, for the entries that asked for them. */
  secrets: Record<string, string>
}
