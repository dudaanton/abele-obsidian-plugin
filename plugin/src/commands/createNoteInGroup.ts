import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { TemplateService } from '@/templates/TemplateService'
import { getAvailablePath, openFile } from '@/helpers/vaultUtils'
import { updateNoteFrontmatter } from '@/helpers/notesUtils'

/**
 * Create a new note with the given file as its group
 */
export async function createNoteInGroup(groupFile: TFile): Promise<void> {
  const { app } = GlobalStore.getInstance()

  // Determine folder from the group file
  const folder = groupFile.parent?.path || ''
  const basePath = folder ? `${folder}/Untitled.md` : 'Untitled.md'
  const filePath = await getAvailablePath(basePath)

  // Create empty file
  const file = await app.vault.create(filePath, '')

  // Apply default template
  await TemplateService.getInstance().applyDefaultTemplate(file)

  // Set groups frontmatter
  await updateNoteFrontmatter(file.path, {
    groups: [`[[${groupFile.basename}]]`],
  })

  // Open the new note
  await openFile(file.path)
}
