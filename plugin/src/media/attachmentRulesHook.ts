/**
 * The folder rules for attachments, put in front of Obsidian's own choice of folder.
 *
 * Every attachment Obsidian saves — a pasted or dropped file, a recording, an image imported on
 * the phone, `FileManager.getAvailablePathForAttachment` that the plugin's own drawings and
 * canvases call — gets its path from `Vault.getAvailablePathForAttachments(name, extension,
 * note)`, none of it published API. That reads the attachment setting, creates the folder when
 * it is missing, and picks a name nothing holds yet. So the folder is swapped at that one
 * place: while it runs for a note under a rule, the setting it reads is the rule's folder,
 * and everything else it does — `./` beside the note, the folder made, the free name, the
 * name cleaned of characters a file system refuses — stays Obsidian's.
 *
 * The setting is read at the start of the call, before its first wait, which is the one moment
 * the swap is in place; the vault's real setting is never written.
 */
import type { Plugin, TFile, Vault } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { attachmentSettingFor } from './attachmentRules'

type ForAttachments = (basename: string, extension: string, file: TFile | null) => Promise<string>

interface AttachmentVault {
  getAvailablePathForAttachments?: ForAttachments
  getConfig?: (key: string) => unknown
}

/** The attachment setting key Obsidian reads, the same one the user sets in Files and links. */
const SETTING = 'attachmentFolderPath'

/**
 * Wraps the vault's choice of attachment path with `settingFor`; the result undoes it. Once
 * undone the wrapper passes straight through, so something that wrapped it on top keeps working.
 */
export function hookAttachmentPaths(
  vault: Vault,
  settingFor: (notePath: string) => string | null
): () => void {
  const target = vault as unknown as AttachmentVault
  const original = target.getAvailablePathForAttachments
  if (typeof original !== 'function') {
    console.warn('[Abele] attachment folder rules: this Obsidian has no hook for them')
    return () => {}
  }
  const own = Object.prototype.hasOwnProperty.call(target, 'getAvailablePathForAttachments')
  let live = true
  const wrapped: ForAttachments = function (this: AttachmentVault, basename, extension, file) {
    const setting = live && file?.path ? settingFor(file.path) : null
    if (setting === null) return original.call(this, basename, extension, file)
    console.debug('[Abele] attachment folder rule', file?.path, '→', setting)
    const ownConfig = Object.prototype.hasOwnProperty.call(this, 'getConfig')
    const getConfig = this.getConfig
    this.getConfig = function (key: string) {
      return key === SETTING ? setting : getConfig?.call(this, key)
    }
    try {
      return original.call(this, basename, extension, file)
    } finally {
      if (ownConfig) this.getConfig = getConfig
      else delete this.getConfig
    }
  }
  target.getAvailablePathForAttachments = wrapped
  return () => {
    live = false
    if (target.getAvailablePathForAttachments !== wrapped) return
    if (own) target.getAvailablePathForAttachments = original
    else delete target.getAvailablePathForAttachments
  }
}

/** The rules from the settings, applied to every attachment the vault saves for a note. */
export function registerAttachmentRules(plugin: Plugin): void {
  const unhook = hookAttachmentPaths(plugin.app.vault, (notePath) =>
    attachmentSettingFor(AbeleConfig.getInstance().attachmentRules, notePath)
  )
  plugin.register(unhook)
}
