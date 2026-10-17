import type { RequestScriptChoice } from '@/components/debugger/http/RequestScriptPicker'
import type { RequestsModel } from './RequestsModel'

export type ScriptMoment = 'before' | 'after'

/** Read the current document at selection time: the picker may have stayed open during edits. */
export async function assignRequestScript(
  model: RequestsModel,
  id: string,
  when: ScriptMoment,
  name: string | undefined
) {
  const doc = model.entry(id).doc
  if (!doc) throw new Error('The request is no longer open')
  const scripts = { ...doc.scripts }
  if (name === undefined) delete scripts[when]
  else scripts[when] = name
  model.change(id, { ...doc, scripts })
  await model.flush(id)
}

export function requestScriptProblems(
  assigned: { before?: string; after?: string },
  scripts: RequestScriptChoice[]
): { before?: string; after?: string } {
  const problems: { before?: string; after?: string } = {}
  for (const when of ['before', 'after'] as const) {
    const name = assigned[when]
    if (!name) continue
    const script = scripts.find((s) => s.name === name)
    if (!script) problems[when] = `There is no script named ${name}`
    else if (!script.request || script.interceptor)
      problems[when] = `${name} needs a // @request line`
  }
  return problems
}
