// The saved requests the agent's tools work on: the project the Requests view shows.
import type { RequestToolContext } from '@/ai/tools/RequestTools'
import { RequestsService } from './RequestsService'
import { outgoing, varsOf } from './resolve'

export function activeRequestsContext(): RequestToolContext | undefined {
  const service = RequestsService.instance()
  const c = service.context.value
  if (!c) return undefined
  return {
    registrationId: c.registrationId,
    worktreeId: c.worktreeId,
    model: service.model(c),
    project: c.label ?? c.projectId,
  }
}

/** The request an agent's send would put on the wire, for the card asking the person: keys and
 * values kept in memory still by name. */
export async function sendPreview(
  id: string,
  environment?: string
): Promise<{ environment: string; text: string } | undefined> {
  const c = activeRequestsContext()
  if (!c || !id) return undefined
  const m = c.model
  const name = environment ?? m.state.environment
  const fileEnvironment = m.files?.environments.find((e) => e.id === name)
  if (name && m.files?.wasEnvironment(name) && !fileEnvironment)
    throw new Error('The environment file is gone')
  const env =
    fileEnvironment?.doc ??
    (name && name !== m.state.environment
      ? await m.rpc.environment(m.projectId, name)
      : m.state.env)
  const doc = m.entry(id).doc ?? (await m.rpc.get(m.projectId, id))
  const vars = varsOf(env, {})
  if (fileEnvironment)
    for (const exposed of fileEnvironment.exposed) {
      if (fileEnvironment.locations[exposed.key] === exposed.file) delete vars[exposed.key]
    }
  const out = outgoing(doc, vars)
  const plain = (t: string) => t.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
  const scripts = [
    doc.scripts.before
      ? `# The script ${plain(doc.scripts.before)} runs first and may change this.`
      : '',
    doc.scripts.after ? `# The script ${plain(doc.scripts.after)} reads the answer.` : '',
  ].filter(Boolean)
  return {
    environment: name ?? 'No environment',
    text: [
      ...scripts,
      `${out.method} ${out.url}`,
      ...Object.entries(out.headers).map(([k, v]) => `${k}: ${v}`),
      ...(out.body !== undefined ? ['', out.body] : []),
    ].join('\n'),
  }
}
