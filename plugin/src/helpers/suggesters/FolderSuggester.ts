// Credits go to Templater Plugin: https://github.com/SilentVoid13/Templater

import { App, TAbstractFile, TFolder } from 'obsidian'
import { TextInputSuggest } from './suggest'

// TODO: rewrite to vue
export class FolderSuggest extends TextInputSuggest<TFolder> {
  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl)
  }

  getSuggestions(inputStr: string): TFolder[] {
    const abstractFiles = this.app.vault.getAllLoadedFiles()
    const folders: TFolder[] = []
    const lowerCaseInputStr = inputStr.toLowerCase()

    abstractFiles.forEach((folder: TAbstractFile) => {
      if (folder instanceof TFolder && folder.path.toLowerCase().contains(lowerCaseInputStr)) {
        folders.push(folder)
      }
    })

    return folders.slice(0, 1000)
  }

  renderSuggestion(file: TFolder, el: HTMLElement): void {
    el.setText(file.path)
  }

  selectSuggestion(file: TFolder): void {
    this.applyValue(file.path)
  }
}

/**
 * Folders with a file somewhere below them, and not the vault root.
 *
 * The Sync tab's "Skip a folder" picker. An empty folder here is most often one another device
 * renamed or emptied and this one kept from before it tidied such folders away; skipping it
 * skips nothing, and offering it reads as a folder that still exists everywhere.
 */
export class FilledFolderSuggest extends FolderSuggest {
  getSuggestions(inputStr: string): TFolder[] {
    return super
      .getSuggestions(inputStr)
      .filter((folder) => folder.path !== '' && folder.path !== '/' && holdsAFile(folder))
  }
}

/** Whether a file sits anywhere below the folder. */
function holdsAFile(folder: TFolder): boolean {
  return (folder.children ?? []).some((child) =>
    child instanceof TFolder ? holdsAFile(child) : true
  )
}
