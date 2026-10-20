// Brings imported requests into the project: each into its folder under a name not yet taken,
// and the values the source named into the environment in use, never over one already there.
import type { RequestsModel } from './RequestsModel'
import type { Imported } from './importers'
import { requestIdFor } from './shapes'

export interface ImportOutcome {
  made: string[]
  /** The collections they went into, the first the one most went into. */
  collections: string[]
  /** Requests of the source not brought in, each with why. */
  skipped: string[]
  /** Values added to the environment, by name. */
  vars: string[]
  leftOut: string[]
  warnings?: string[]
}

export async function importInto(
  model: RequestsModel,
  imported: Imported,
  collection?: string
): Promise<ImportOutcome> {
  if (!model.state.collections.length && !model.state.environments.length) await model.load()
  const taken = new Set(model.state.collections.flatMap((c) => c.requests.map((r) => r.id)))
  const made: string[] = []
  const into = new Map<string, number>()
  for (const r of imported.requests) {
    const folder =
      requestIdFor(collection ?? r.collection ?? imported.collection, 'x').replace(
        /\/?x\.http$/,
        ''
      ) || 'Imported'
    into.set(folder, (into.get(folder) ?? 0) + 1)
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
  return {
    made,
    collections: [...into].sort((a, b) => b[1] - a[1]).map(([c]) => c),
    skipped: imported.skipped ?? [],
    vars: added,
    leftOut: imported.leftOut,
    ...(imported.warnings?.length ? { warnings: imported.warnings } : {}),
  }
}

/** What an import did, in a line or two: `Imported 3 requests into Orders; 1 skipped.` */
export function importWords(o: ImportOutcome, environment?: string): string {
  const n = o.made.length
  const where =
    o.collections.length > 1
      ? `${o.collections[0]} and ${o.collections.length - 1} more`
      : (o.collections[0] ?? 'the project')
  return [
    `Imported ${n} request${n === 1 ? '' : 's'} into ${where}${o.skipped.length ? `; ${o.skipped.length} skipped` : ''}.`,
    o.vars.length ? `Added to ${environment ?? 'the environment'}: ${o.vars.join(', ')}.` : '',
    o.leftOut.length
      ? `Left out, as they carried credentials: ${o.leftOut.join(', ')}. Put them back as saved keys, \${abele_key:name}.`
      : '',
    ...(o.warnings ?? []),
  ]
    .filter(Boolean)
    .join(' ')
}
