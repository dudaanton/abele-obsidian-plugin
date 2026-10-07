import { isChatLog } from '../chatText'

/** Chat content belongs to its single writer and owner-review controls, never file tools. */
export function guardChatWrite(path: string): void {
  if (path.toLowerCase().endsWith('.abcomment'))
    throw new Error(
      'Human comment files can only be changed through comment controls, not file tools or script file operations.'
    )
  if (isChatLog(path))
    throw new Error(
      'Chat files can only be changed through chat controls and reply review, not file tools or script file operations.'
    )
}
