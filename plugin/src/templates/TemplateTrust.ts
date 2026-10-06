import { Notice } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScriptTrust, sha256 } from '@/scripting/ScriptTrust'
import { reviewScript } from '@/scripting/reviewScript'
import { parseTemplateVariables } from './TemplateParser'
import type { UserTemplate } from './UserTemplate'

/** Reuse a still-visible review notice, but never suppress one that the user dismissed. */
const pending = new WeakMap<ScriptTrust, Map<string, Notice>>()

export type TemplateExecutionSettings = Pick<
  UserTemplate,
  'templateFor' | 'callbacks' | 'targetFolder' | 'targetName' | 'targetProperties'
>

/** Review and hash the exact prepared body and settings that this application will consume. */
export function templateReviewSource(
  template: TemplateExecutionSettings,
  text: string,
  body: string
): string {
  const settings = {
    template_for: template.templateFor,
    callbacks: template.callbacks,
    target_folder: template.targetFolder,
    target_name: template.targetName,
    target_properties: template.targetProperties,
  }
  return `Template execution settings:\n${JSON.stringify(settings, null, 2)}\n\nPrepared template body:\n${body}\n\nFull template:\n${text}`
}

export async function allowTemplateExecution(
  path: string,
  name: string,
  source: string,
  executable: boolean
): Promise<boolean> {
  if (!executable) return true
  const trust = ScriptTrust.forTemplates()
  const hash = await sha256(source)
  if (trust.verdict(path, hash) === 'confirmed') return true
  let notices = pending.get(trust)
  if (!notices) pending.set(trust, (notices = new Map()))
  const key = `${path}\0${hash}`
  if (notices.get(key)?.containerEl.isConnected) return false
  const button = createEl('button', { text: 'Review', cls: 'mod-cta' })
  const fragment = createFragment()
  fragment.append(
    createDiv({
      text: `Template "${name}": commands and plugin methods were not run. The note can still be made. Review and confirm this version on this device to enable them next time.`,
    }),
    button
  )
  const notice = new Notice(fragment, 0)
  notices.set(key, notice)
  button.addEventListener('click', () => {
    // Review exactly the held-back snapshot, never approve whatever arrived during the dialog.
    void reviewScript(GlobalStore.getInstance().app, {
      template: { path, name, source },
      previous: trust.lastConfirmed(path),
    })
      .then((yes) => {
        if (yes) {
          trust.confirm({ path, hash, text: source })
          notices.delete(key)
          notice.hide()
        }
      })
      .catch((error) => console.error('Could not review template', error))
  })
  return false
}

/** Capture and check once at application time; every executable part consumes this snapshot. */
export async function prepareTemplate(template: UserTemplate) {
  const text = await template.getContent()
  const body = await template.getBody(text)
  // The indexed template can outlive its file version or change while a plugin call awaits.
  // Never grant its later fields the verdict of the snapshot reviewed here.
  const settings: TemplateExecutionSettings = {
    templateFor: template.templateFor,
    callbacks: [...template.callbacks],
    targetFolder: template.targetFolder,
    targetName: template.targetName,
    targetProperties: template.targetProperties.map((prop) => ({ ...prop })),
  }
  const sources = [
    body,
    settings.targetFolder,
    settings.targetName,
    ...settings.targetProperties.map((prop) => prop.value),
  ]
  const executable =
    settings.callbacks.length > 0 ||
    sources.some(
      (source) =>
        source &&
        parseTemplateVariables(source).variables.some((variable) => variable.type === 'plugin')
    )
  const allowed = await allowTemplateExecution(
    template.file.path,
    template.name,
    templateReviewSource(settings, text, body),
    executable
  )
  return { body, allowed, settings }
}
