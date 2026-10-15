// An OpenAPI (or Swagger 2) description: one request per operation, in the folder of its first
// tag, its path parameters as variables of the environment and the first server as `base`.
import type { EnvVar, Pair } from '../wire'
import { credential, isMethod, leave, request, type Imported, type ImportedRequest } from './shared'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown) =>
  v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v)

/** A parameter or a schema's example, default, or first allowed value. */
function sample(p: Obj): string {
  const schema = obj(p.schema)
  for (const v of [p.example, schema.example, p.default, schema.default, list(schema.enum)[0]])
    if (v !== undefined) return text(v)
  return ''
}

function serverOf(doc: Obj): string {
  const first = obj(list(doc.servers)[0])
  if (typeof first.url === 'string') {
    let url = first.url
    for (const [name, v] of Object.entries(obj(first.variables)))
      url = url.replace(`{${name}}`, text(obj(v).default))
    return url.replace(/\/$/, '')
  }
  if (typeof doc.host === 'string')
    return `${text(list(doc.schemes)[0]) || 'https'}://${doc.host}${text(doc.basePath).replace(/\/$/, '')}`
  return ''
}

export function importOpenApi(doc: Obj): Imported {
  const title = text(obj(doc.info).title) || 'Imported'
  const leftOut: string[] = []
  const skipped: string[] = []
  const base = serverOf(doc)
  const vars: EnvVar[] = base ? [{ key: 'base', value: base }] : []
  const requests: ImportedRequest[] = []
  for (const [path, item] of Object.entries(obj(doc.paths))) {
    const shared = list(obj(item).parameters).map(obj)
    for (const [verb, raw] of Object.entries(obj(item))) {
      const method = verb.toUpperCase()
      if (verb === 'trace')
        skipped.push(`${verb.toUpperCase()} ${path}: TRACE is not a method a request can have`)
      if (!isMethod(method)) continue
      const op = obj(raw)
      const parameters = [...shared, ...list(op.parameters).map(obj)]
      const params: Pair[] = []
      const headers: Pair[] = []
      for (const p of parameters) {
        const name = text(p.name)
        if (!name) continue
        if (p.in === 'path' && !vars.some((v) => v.key === name))
          vars.push({ key: name, value: sample(p) })
        else if (p.in === 'query') params.push({ key: name, value: sample(p) })
        else if (p.in === 'header') {
          if (credential(name, sample(p))) leave(leftOut, name)
          else headers.push({ key: name, value: sample(p) })
        }
      }
      const content = obj(obj(op.requestBody).content)
      const json = obj(content['application/json'])
      const form = obj(content['application/x-www-form-urlencoded'])
      const example =
        json.example ?? obj(Object.values(obj(json.examples))[0]).value ?? obj(json.schema).example
      const formExample = form.example ?? obj(form.schema).example
      const body =
        example !== undefined
          ? { format: 'json' as const, text: JSON.stringify(example, null, 2) }
          : formExample !== undefined
            ? {
                format: 'form' as const,
                text: Object.entries(obj(formExample))
                  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(text(v))}`)
                  .join('&'),
              }
            : undefined
      if (body && !headers.some((h) => /^content-type$/i.test(h.key)))
        headers.unshift({
          key: 'Content-Type',
          value: body.format === 'json' ? 'application/json' : 'application/x-www-form-urlencoded',
        })
      requests.push({
        collection: text(list(op.tags)[0]) || title,
        doc: request({
          name: text(op.summary) || text(op.operationId) || `${method} ${path}`,
          method,
          url: `${base ? '{{base}}' : ''}${path.replace(/\{([^}]+)\}/g, '{{$1}}')}`,
          params,
          headers,
          ...(body ? { body } : {}),
        }),
      })
    }
  }
  return { collection: title, requests, vars, leftOut, skipped }
}
