import { Notice, type App, type TFolder } from 'obsidian'
import { promptDialog } from '@/components/obsidian/dialogs'
import { newDocumentParent } from '@/helpers/newDocument'
import { DECK_VIEW_TYPE } from './opening'

export async function newDeck(app: App, folder?: TFolder): Promise<void> {
  const parent = newDocumentParent(app, folder)
  const name = await promptDialog({
    title: 'New presentation',
    label: 'Presentation name',
    placeholder: 'Presentation name',
    submitText: 'Create',
    autofocus: false,
    validate: (value) => {
      if (
        !value.trim() ||
        value.startsWith('.') ||
        Array.from(value).some(
          (c) =>
            c.charCodeAt(0) < 32 ||
            ['\\', '/', '#', '|', '[', ']', '^', '*', '"', '<', '>', '?', ':'].includes(c)
        )
      )
        throw new Error('Enter a presentation name without folders or reserved characters')
      return value.endsWith('.md') ? value : `${value}.md`
    },
  })
  if (!name) return
  try {
    const path = parent.path === '/' ? name : `${parent.path}/${name}`
    const file = await app.vault.create(path, '---\ntype: presentation\n---\n# Presentation\n')
    const leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: DECK_VIEW_TYPE, state: { file: file.path }, active: true })
    await app.workspace.revealLeaf(leaf)
  } catch (error) {
    console.error('[Abele] Presentation creation failed:', error)
    new Notice(
      `Presentation could not be created: ${error instanceof Error ? error.message : 'unknown error'}`
    )
  }
}
