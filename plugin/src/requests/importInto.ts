// Brings imported requests into the project: each into its folder under a name not yet taken,
// and the values the source named into the environment in use, never over one already there.
import type { RequestsModel } from './RequestsModel'
import type { Imported } from './importers'
import { requestIdFor } from './shapes'

export interface ImportOutcome {
  made: string[]
  /** Values added to the environment, by name. */
  vars: string[]
  leftOut: string[]
}

export async function importInto(
  model: RequestsModel,
  imported: Imported,
  collection?: string
): Promise<ImportOutcome> {
  if (!model.state.collections.length && !model.state.environments.length) await model.load()
  const taken = new Set(model.state.collections.flatMap((c) => c.requests.map((r) => r.id)))
  const made: string[] = []
  for (const r of imported.requests) {
    const folder = collection ?? r.collection ?? imported.collection
    let name = r.doc.name
    for (let n = 2; taken.has(requestIdFor(folder, name)); n++) name = `${r.doc.name} ${n}`
    taken.add(requestIdFor(folder, name))
    made.push(await model.create(folder, name, { ...r.doc, name }))
  }
  const added: string[] = []
  if (imported.vars.length) {
    if (!model.state.env) await model.createEnvironment('local')
    const env = model.state.env!
    const vars = [...env.vars]
    for (const v of imported.vars)
      if (!vars.some((x) => x.key === v.key)) {
        vars.push(v)
        added.push(v.key)
      }
    if (added.length) await model.saveEnvironment({ ...env, vars })
  }
  return { made, vars: added, leftOut: imported.leftOut }
}

/** What an import did, in a line or two. */
export function importWords(o: ImportOutcome, environment?: string): string {
  return [
    `Imported ${o.made.length} request${o.made.length === 1 ? '' : 's'}.`,
    o.vars.length ? `Added to ${environment ?? 'the environment'}: ${o.vars.join(', ')}.` : '',
    o.leftOut.length
      ? `Left out, as they carried credentials: ${o.leftOut.join(', ')}. Put them back as saved keys, \${abele_key:name}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}
