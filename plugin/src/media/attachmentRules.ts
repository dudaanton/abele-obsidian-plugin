/**
 * Folder rules for attachments: a note under a ruled folder keeps its pasted and dropped files
 * in the folder that rule names, in place of the vault's one attachment setting.
 *
 * No Obsidian here — paths are strings. The adapter (`attachmentRulesHook.ts`) asks which rule
 * a note falls under and hands Obsidian the folder it names.
 *
 * - A rule covers its folder and every folder below it; the deepest covering rule wins, so a
 *   rule on `Projects/Work` beats one on `Projects` for a note in `Projects/Work/Plans`.
 * - `/` as the notes folder is the vault root: it covers every note no deeper rule takes.
 * - A rule with either folder left empty is unfinished and covers nothing — a row just added on
 *   the settings screen must not send every note's files to the vault root.
 * - Folders compare without regard to case, as Obsidian finds the attachment folder itself: the
 *   file systems of the desktop and the phone cannot hold two folders differing only in case.
 * - The attachments folder is written the way Obsidian's own setting is: `/` for the vault
 *   root, `./` for the note's own folder, `./name` for a folder beside the note.
 */

export interface AttachmentRule {
  /** The folder whose notes, at any depth, this rule takes. `/` is the whole vault. */
  notesFolder: string
  /** Where those notes' attachments go, in the form of Obsidian's attachment setting. */
  attachmentsFolder: string
}

/** A vault path as Obsidian keeps one: forward slashes, none doubled, none at either end. */
export function normalizeFolder(path: string): string {
  return path
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .normalize('NFC')
}

/** The rule's attachments folder as a value of Obsidian's attachment setting. */
export function attachmentSetting(folder: string): string {
  const raw = folder.trim().replace(/\\+/g, '/')
  if (raw === '.' || /^\.\/+$/.test(raw)) return './'
  if (raw.startsWith('./')) {
    const below = normalizeFolder(raw.slice(2))
    return below ? `./${below}` : './'
  }
  return normalizeFolder(raw) || '/'
}

/** Whether both folders are filled in. */
export function isCompleteRule(rule: AttachmentRule): boolean {
  return rule.notesFolder.trim() !== '' && rule.attachmentsFolder.trim() !== ''
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
  return rule ? attachmentSetting(rule.attachmentsFolder) : null
}

/** Rules as a settings file may hold them: anything not a pair of strings is dropped. */
export function attachmentRulesFrom(raw: unknown): AttachmentRule[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((rule): rule is Record<string, unknown> => !!rule && typeof rule === 'object')
    .filter(
      (rule) => typeof rule.notesFolder === 'string' && typeof rule.attachmentsFolder === 'string'
    )
    .map((rule) => ({
      notesFolder: rule.notesFolder as string,
      attachmentsFolder: rule.attachmentsFolder as string,
    }))
}
