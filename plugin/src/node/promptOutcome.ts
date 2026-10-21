import type { Prompt } from '@abele/node-protocol'

/** A transport or runtime settling a prompt is not an authenticated owner decision. */
export function cancelledPrompt(
  prompt: Pick<Prompt, 'state' | 'choice' | 'installation_id'>
): boolean {
  return (
    prompt.state === 'invalidated' ||
    (prompt.state === 'resolved' && prompt.choice === 'deny' && prompt.installation_id === null)
  )
}
