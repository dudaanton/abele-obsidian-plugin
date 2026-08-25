// Credits go to Templater Plugin: https://github.com/SilentVoid13/Templater

import { App, TAbstractFile, TFile } from 'obsidian'
import { TextInputSuggest } from './suggest'
import { getNotesFromFolder } from '../notesUtils'

export enum FileSuggestMode {
  TemplateFiles,
  ScriptFiles,
}

export class FileSuggest extends TextInputSuggest<TFile> {
  private allFileTypes: boolean

  constructor(app: App, inputEl: HTMLInputElement, options?: { allFileTypes?: boolean }) {
    super(app, inputEl)
    this.allFileTypes = options?.allFileTypes ?? false
  }

  getSuggestions(input_str: string): TFile[] {
    const all_files = getNotesFromFolder('/')
    if (!all_files) {
      return []
    }

    const files: TFile[] = []
    const lower_input_str = input_str.toLowerCase()

    all_files.forEach((file: TAbstractFile) => {
      if (
        file instanceof TFile &&
        (this.allFileTypes || file.extension === 'md') &&
        file.path.toLowerCase().contains(lower_input_str)
      ) {
        files.push(file)
      }
    })

    return files.slice(0, 1000)
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path)
  }

  selectSuggestion(file: TFile): void {
    this.applyValue(file.path)
  }
}
