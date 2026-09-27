/**
 * The dialog a script from elsewhere is confirmed in: why it waits, what it is, yes or not now.
 *
 * What it shows is the version the index holds — the one that would run — against the last
 * version confirmed on this device when there is one, as one column with what went and what
 * came marked in it (a side-by-side diff has no room on a phone), and the whole file otherwise.
 * Read-only: changing the code here would confirm something nobody reviewed.
 */
import { App, Platform } from 'obsidian'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { unifiedMergeView } from '@codemirror/merge'
import { ShellModal } from '@/modal/ShellModal'
import type { ParsedScript } from './types'

export interface ReviewRequest {
  script: ParsedScript
  /** The text last confirmed at this path, when this device kept it. */
  previous?: string
  /** Refused by where it came from: shown, but there is nothing to confirm. */
  refused?: boolean
}

/** Resolves true only when Confirm was pressed; any other way of closing it is a no. */
export function reviewScript(app: App, request: ReviewRequest): Promise<boolean> {
  const { script, previous, refused } = request
  const text = script.source ?? script.code
  return new Promise((resolve) => {
    let confirmed = false
    let view: EditorView | null = null
    const modal = new (class extends ShellModal {
      onClose(): void {
        super.onClose()
        view?.destroy()
        view = null
        resolve(confirmed)
      }
    })(app, {
      title: `Confirm script "${script.meta.name}"`,
      size: 'tall',
      footer: true,
      cls: ['abele-script-review'],
    })

    const body = modal.bodyEl
    body.createEl('p', {
      cls: 'abele-script-review__why',
      text: refused
        ? 'This version arrived through a connection that is not allowed to bring scripts to this device, so it does not run here. Change the script on this device to run it.'
        : previous !== undefined
          ? 'This script changed without being written on this device — through sync or another app. Buttons, automations, startup and agents will not run it until you confirm the change here.'
          : 'This script appeared without being written on this device — through sync or another app. Buttons, automations, startup and agents will not run it until you confirm it here.',
    })
    body.createEl('p', {
      cls: 'abele-script-review__path setting-item-description',
      text:
        previous !== undefined
          ? `${script.path} — changes against the version last confirmed here`
          : script.path,
    })

    const codeEl = body.createDiv({ cls: 'abele-script-review__code' })
    view = new EditorView({
      parent: codeEl,
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          lineNumbers(),
          javascript(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          ...(previous !== undefined
            ? [
                unifiedMergeView({
                  original: previous,
                  mergeControls: false,
                  highlightChanges: !Platform.isPhone,
                }),
              ]
            : []),
        ],
      }),
    })

    if (refused) {
      modal.addButton('Close', () => modal.close(), { cta: true })
    } else {
      modal.addButton('Not now', () => modal.close(), {
        tooltip: 'Leave it waiting; nothing runs it',
      })
      modal.addButton(
        'Confirm',
        () => {
          confirmed = true
          modal.close()
        },
        { cta: true, tooltip: 'Let this version run on this device' }
      )
    }
    modal.open()
  })
}
