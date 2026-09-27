import type { App } from 'obsidian'
import { ShellModal } from './ShellModal'

/**
 * Asks for the name of something about to be made — a script, a CSS snippet. Resolves with the
 * trimmed name, or null when the dialog was dismissed or left empty.
 *
 * One dialog of the shell with a field and Create / Cancel under it. The script and snippet
 * commands each built their own copy by hand, with a heading inside the body and no button to
 * press on a phone, where there is no Enter key to be seen above a keyboard's Go.
 */
export function askName(
  app: App,
  options: { title: string; placeholder?: string }
): Promise<string | null> {
  return new Promise((resolve) => {
    let answered = false
    const answer = (value: string | null) => {
      if (answered) return
      answered = true
      resolve(value)
    }

    const modal = new (class extends ShellModal {
      onClose(): void {
        super.onClose()
        answer(null)
      }
    })(app, { title: options.title, footer: true })

    const input = modal.bodyEl.createEl('input', {
      type: 'text',
      placeholder: options.placeholder ?? 'filename',
      cls: 'abele-name-input',
    })
    const submit = () => {
      const value = input.value.trim()
      if (!value) return
      answer(value)
      modal.close()
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit()
    })
    modal.addButton('Cancel', () => modal.close())
    modal.addButton('Create', submit, { cta: true })

    modal.open()
    input.focus()
  })
}
