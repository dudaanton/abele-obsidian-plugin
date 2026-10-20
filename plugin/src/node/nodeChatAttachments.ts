import { t } from '@/i18n'

/** A selected text file travels in the ordinary message; no device path reaches the node. */
export async function nodeAttachmentText(file: File): Promise<string> {
  if (file.size > 48 * 1024) throw new Error(t('streamB.nodeAttachmentTooLarge'))
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
  } catch {
    throw new Error(t('streamB.nodeAttachmentTextOnly'))
  }
  if (text.includes(String.fromCharCode(0))) throw new Error(t('streamB.nodeAttachmentTextOnly'))
  return `${file.name.replace(/[\r\n]/g, ' ')}\n${text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')}`
}
