/**
 * Folder rules for attachments: a note under a ruled folder keeps its pasted and dropped files
 * where that rule says, in place of the vault's one attachment setting.
 *
 * No Obsidian here — paths are strings. The adapter (`attachmentRulesHook.ts`) asks which rule
 * a note falls under and hands Obsidian the setting it stands for.
 *
 * - A rule covers its folder and every folder below it; the deepest covering rule wins, so a
 *   rule on `Projects/Work` beats one on `Projects` for a note in `Projects/Work/Plans`.
 * - `/` as the notes folder is the vault root: it covers every note no deeper rule takes.
 * - Where the files go is one of Obsidian's own three choices for its attachment setting: a
 *   folder named in full, the note's own folder, or a subfolder of the note's folder.
 * - A rule is unfinished, and covers nothing, until what its choice needs is filled in — a row
 *   just added on the settings screen must not send every note's files to the vault root.
 * - Folders compare without regard to case, as Obsidian finds the attachment folder itself: the
 *   file systems of the desktop and the phone cannot hold two folders differing only in case.
 */

/** Obsidian's three places for attachments: a named folder, beside the note, under it. */
export type AttachmentLocation = 'folder' | 'note' | 'subfolder'

export const ATTACHMENT_LOCATIONS: AttachmentLocation[] = ['note', 'folder', 'subfolder']

export interface AttachmentRule {
  /** The folder whose notes, at any depth, this rule takes. `/` is the whole vault. */
  notesFolder: string
  location: AttachmentLocation
  /** The folder for `folder`; `/` is the vault root. Kept while another choice is made. */
  attachmentsFolder: string
  /** The subfolder's name for `subfolder`. Kept while another choice is made. */
  subfolder: string
}

/** A vault path as Obsidian keeps one: forward slashes, none doubled, none at either end. */
export function normalizeFolder(path: string): string {
  return path
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .normalize('NFC')
}

/** The rule's place as a value of Obsidian's attachment setting: `/`, a path, `./` or `./sub`. */
export function ruleSetting(rule: AttachmentRule): string {
  if (rule.location === 'note') return './'
  if (rule.location === 'subfolder') {
    const below = normalizeFolder(rule.subfolder)
    return below ? `./${below}` : './'
  }
  return normalizeFolder(rule.attachmentsFolder) || '/'
}

/** Whether the notes folder, and what the rule's choice needs, are filled in. */
export function isCompleteRule(rule: AttachmentRule): boolean {
  if (rule.notesFolder.trim() === '') return false
  if (rule.location === 'note') return true
  return (rule.location === 'subfolder' ? rule.subfolder : rule.attachmentsFolder).trim() !== ''
}

/** The folder's depth: 0 for the root, 1 for a folder in it, and so on. */
const depth = (folder: string): number => (folder ? folder.split('/').length : 0)

/**
 * The rule the note at `notePath` falls under, or null when none does and the vault's own
 * setting applies. Of two rules on the same folder the first in the list wins.
 */
export function attachmentRuleFor(
  rules: readonly AttachmentRule[],
  notePath: string
): AttachmentRule | null {
  const note = normalizeFolder(notePath).toLowerCase()
  let best: AttachmentRule | null = null
  let bestDepth = -1
  for (const rule of rules) {
    if (!isCompleteRule(rule)) continue
    const folder = normalizeFolder(rule.notesFolder).toLowerCase()
    const covers = folder === '' || note.startsWith(`${folder}/`)
    if (covers && depth(folder) > bestDepth) {
      best = rule
      bestDepth = depth(folder)
    }
  }
  return best
}

/** The attachment setting for the note's files under the rules, or null for the vault's own. */
export function attachmentSettingFor(
  rules: readonly AttachmentRule[],
  notePath: string
): string | null {
  const rule = attachmentRuleFor(rules, notePath)
  return rule ? ruleSetting(rule) : null
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * Rules as a settings file or a transfer may hold them. Anything without a notes folder is
 * dropped. A rule from the first shape, which wrote the note's own folder as `./` and a
 * subfolder as `./name` into the folder itself, is moved to the matching choice.
 */
export function attachmentRulesFrom(raw: unknown): AttachmentRule[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((rule): rule is Record<string, unknown> => !!rule && typeof rule === 'object')
    .filter((rule) => typeof rule.notesFolder === 'string')
    .map((rule) => {
      const notesFolder = rule.notesFolder as string
      const folder = text(rule.attachmentsFolder)
      const subfolder = text(rule.subfolder)
      if (ATTACHMENT_LOCATIONS.includes(rule.location as AttachmentLocation))
        return {
          notesFolder,
          location: rule.location as AttachmentLocation,
          attachmentsFolder: folder,
          subfolder,
        }
      const old = folder.trim().replace(/\\+/g, '/')
      if (old === '.' || /^\.\/+$/.test(old))
        return { notesFolder, location: 'note', attachmentsFolder: '', subfolder }
      if (old.startsWith('./'))
        return {
          notesFolder,
          location: 'subfolder',
          attachmentsFolder: '',
          subfolder: normalizeFolder(old.slice(2)),
        }
      return { notesFolder, location: 'folder', attachmentsFolder: folder, subfolder }
    })
}
