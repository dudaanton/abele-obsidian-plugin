import { Notice } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScriptTrust, sha256 } from '@/scripting/ScriptTrust'
import { reviewScript } from '@/scripting/reviewScript'
import { parseTemplateVariables } from './TemplateParser'
import type { UserTemplate } from './UserTemplate'

/** Once per version and session, just like the notice for waiting scripts. */
const announced = new WeakMap<ScriptTrust, Set<string>>()

/**
 * Reuse script approvals and review, but always require an explicit local confirmation.
 * Include the indexed execution settings in what is reviewed and hashed: metadata can lag
 * the file's text, and an approval must cover the exact settings used as well as all its text.
 */
export function templateReviewSource(template: UserTemplate, text: string): string {
  const settings = {
    callbacks: template.callbacks,
    target_folder: template.targetFolder,
    target_name: template.targetName,
    target_properties: template.targetProperties,
  }
  return `Template execution settings:\n${JSON.stringify(settings, null, 2)}\n\nFull template:\n${text}`
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
  let seen = announced.get(trust)
  if (!seen) announced.set(trust, (seen = new Set()))
  const key = `${path}\0${hash}`
  if (seen.has(key)) return false
  seen.add(key)
  const button = createEl('button', { text: 'Review', cls: 'mod-cta' })
  const fragment = createFragment()
  fragment.append(
    createDiv({
      text: `Template "${name}": commands and plugin methods were not run. The note can still be made. Review and confirm this version on this device to enable them next time.`,
    }),
    button
  )
  const notice = new Notice(fragment, 0)
  button.addEventListener('click', () => {
    // Review exactly the held-back snapshot, never approve whatever arrived during the dialog.
    void reviewScript(GlobalStore.getInstance().app, {
      template: { path, name, source },
      previous: trust.lastConfirmed(path),
    })
      .then((yes) => {
        if (yes) {
          trust.confirm({ path, hash, text: source })
          notice.hide()
        }
      })
      .catch((error) => console.error('Could not review template', error))
  })
  return false
}

/** One read and one verdict for every executable part of a template application. */
export async function prepareTemplate(template: UserTemplate) {
  const text = await template.getContent()
  const body = await template.getBody(text)
  const sources = [
    body,
    template.targetFolder,
    template.targetName,
    ...template.targetProperties.map((prop) => prop.value),
  ]
  const executable =
    template.callbacks.length > 0 ||
    sources.some(
      (source) =>
        source &&
        parseTemplateVariables(source).variables.some((variable) => variable.type === 'plugin')
    )
  const allowed = await allowTemplateExecution(
    template.file.path,
    template.name,
    templateReviewSource(template, text),
    executable
  )
  return { body, allowed }
}
