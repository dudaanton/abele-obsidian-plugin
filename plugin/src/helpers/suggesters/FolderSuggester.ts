// Credits go to Templater Plugin: https://github.com/SilentVoid13/Templater

import { App, TAbstractFile, TFolder } from 'obsidian'
import { TextInputSuggest } from './suggest'

// TODO: rewrite to vue
export class FolderSuggest extends TextInputSuggest<TFolder> {
  constructor(app: App, inputEl: HTMLInputElement | HTMLTextAreaElement) {
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
    this.inputEl.value = file.path
    this.inputEl.trigger('input')
    this.close()
  }
}
