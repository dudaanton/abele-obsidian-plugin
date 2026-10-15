// Collections other clients export as JSON: Postman (v2.0, v2.1), Insomnia (v4) and Bruno. Folders
// become collections, the export's variables values of the environment; a request this cannot
// carry (a file upload, a GraphQL or binary body, a method no request has) is skipped and said.
import type { EnvVar, Pair } from '../wire'
import {
  SECRET_NAME,
  bodyFormat,
  credential,
  isMethod,
  leave,
  request,
  splitQuery,
  type Imported,
  type ImportedRequest,
} from './shared'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown) =>
  v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
/** `:id` path variables and Insomnia's `{{ _.name }}` become `{{name}}`. */
const vars = (t: string) => t.replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, '{{$1}}')

function variable(out: EnvVar[], key: string, value: unknown) {
  if (!key || out.some((v) => v.key === key)) return
  out.push(SECRET_NAME.test(key) ? { key, secret: true } : { key, value: text(value) })
}

function headersOf(raw: unknown[], leftOut: string[]): Pair[] {
  const out: Pair[] = []
  for (const h of raw.map(obj)) {
    const key = text(h.key ?? h.name)
    const value = vars(text(h.value))
    if (!key) continue
    if (credential(key, value)) leave(leftOut, key)
    else
      out.push({ key, value, ...(h.disabled === true || h.enabled === false ? { off: true } : {}) })
  }
  return out
}

function build(
  name: string,
  method: string,
  address: string,
  headers: Pair[],
  body: { format?: 'json' | 'text' | 'form'; text: string } | undefined,
  collection: string | undefined,
  skipped: string[]
): ImportedRequest[] {
  const m = method.toUpperCase()
  if (!isMethod(m)) {
    skipped.push(`${name}: ${m || 'no method'} is not a method a request can have`)
    return []
  }
  const { url, params } = splitQuery(vars(address))
  const t = body?.text.trim()
  return [
    {
      ...(collection ? { collection } : {}),
      doc: request({
        name,
        method: m,
        url,
        params,
        headers,
        ...(t ? { body: { format: body!.format ?? bodyFormat(headers, t), text: t } } : {}),
      }),
    },
  ]
}

/** A Postman collection, v2.0 or v2.1. */
export function importPostman(doc: Obj): Imported {
  const title = text(obj(doc.info).name) || 'Imported'
  const leftOut: string[] = []
  const skipped: string[] = []
  const env: EnvVar[] = []
  for (const v of list(doc.variable).map(obj)) variable(env, text(v.key), v.value)
  if (obj(doc.auth).type && obj(doc.auth).type !== 'noauth') leave(leftOut, 'the collection’s auth')
  const requests: ImportedRequest[] = []
  const walk = (items: unknown[], folder: string | undefined) => {
    for (const item of items.map(obj)) {
      const name = text(item.name) || 'Request'
      if (Array.isArray(item.item)) {
        walk(item.item, folder ? `${folder}/${name}` : name)
        continue
      }
      const r = typeof item.request === 'string' ? { url: item.request } : obj(item.request)
      const u = r.url
      const address = typeof u === 'string' ? u : text(obj(u).raw)
      if (obj(r.auth).type && obj(r.auth).type !== 'noauth') leave(leftOut, `the auth of ${name}`)
      const b = obj(r.body)
      let body: { format?: 'json' | 'text' | 'form'; text: string } | undefined
      if (b.mode === 'raw') body = { text: vars(text(b.raw)) }
      else if (b.mode === 'urlencoded')
        body = {
          format: 'form',
          text: list(b.urlencoded)
            .map(obj)
            .filter((p) => p.disabled !== true)
            .map(
              (p) => `${encodeURIComponent(text(p.key))}=${encodeURIComponent(vars(text(p.value)))}`
            )
            .join('&'),
        }
      else if (b.mode && b.mode !== 'none') {
        skipped.push(`${name}: a ${text(b.mode)} body`)
        continue
      }
      requests.push(
        ...build(
          name,
          text(r.method) || 'GET',
          address,
          headersOf(list(r.header), leftOut),
          body,
          folder,
          skipped
        )
      )
    }
  }
  walk(list(doc.item), undefined)
  return { collection: title, requests, vars: env, leftOut, skipped }
}

/** An Insomnia export, v4: requests in their groups, the base environment's values. */
export function importInsomnia(doc: Obj): Imported {
  const resources = list(doc.resources).map(obj)
  const leftOut: string[] = []
  const skipped: string[] = []
  const env: EnvVar[] = []
  const byId = new Map(resources.map((r) => [text(r._id), r]))
  const workspace = resources.find((r) => r._type === 'workspace')
  for (const e of resources.filter((r) => r._type === 'environment'))
    for (const [k, v] of Object.entries(obj(e.data))) variable(env, k, v)
  const folderOf = (parent: string): string | undefined => {
    const p = byId.get(parent)
    if (!p || p._type !== 'request_group') return undefined
    const above = folderOf(text(p.parentId))
    return above ? `${above}/${text(p.name)}` : text(p.name)
  }
  const requests: ImportedRequest[] = []
  for (const r of resources.filter((x) => x._type === 'request')) {
    const name = text(r.name) || 'Request'
    if (obj(r.authentication).type && obj(r.authentication).type !== 'none')
      leave(leftOut, `the auth of ${name}`)
    const b = obj(r.body)
    const mime = text(b.mimeType)
    let body: { format?: 'json' | 'text' | 'form'; text: string } | undefined
    if (b.text !== undefined) body = { text: vars(text(b.text)) }
    else if (mime === 'application/x-www-form-urlencoded')
      body = {
        format: 'form',
        text: list(b.params)
          .map(obj)
          .filter((p) => p.disabled !== true)
          .map(
            (p) => `${encodeURIComponent(text(p.name))}=${encodeURIComponent(vars(text(p.value)))}`
          )
          .join('&'),
      }
    else if (mime) {
      skipped.push(`${name}: a ${mime} body`)
      continue
    }
    const params = list(r.parameters)
      .map(obj)
      .map((p) => `${encodeURIComponent(text(p.name))}=${encodeURIComponent(vars(text(p.value)))}`)
    const address =
      text(r.url) +
      (params.length ? `${text(r.url).includes('?') ? '&' : '?'}${params.join('&')}` : '')
    requests.push(
      ...build(
        name,
        text(r.method) || 'GET',
        address,
        headersOf(list(r.headers), leftOut),
        body,
        folderOf(text(r.parentId)),
        skipped
      )
    )
  }
  return { collection: text(workspace?.name) || 'Imported', requests, vars: env, leftOut, skipped }
}

/** A Bruno collection exported as JSON. */
export function importBrunoExport(doc: Obj): Imported {
  const leftOut: string[] = []
  const skipped: string[] = []
  const env: EnvVar[] = []
  for (const e of list(doc.environments).map(obj))
    for (const v of list(e.variables).map(obj))
      if (v.secret !== true) variable(env, text(v.name), v.value)
      else variable(env, text(v.name), '')
  const requests: ImportedRequest[] = []
  const walk = (items: unknown[], folder: string | undefined) => {
    for (const item of items.map(obj)) {
      const name = text(item.name) || 'Request'
      if (item.type === 'folder') {
        walk(list(item.items), folder ? `${folder}/${name}` : name)
        continue
      }
      if (item.type !== 'http-request') {
        skipped.push(`${name}: a ${text(item.type) || 'kind of'} request`)
        continue
      }
      const r = obj(item.request)
      if (obj(r.auth).mode && obj(r.auth).mode !== 'none') leave(leftOut, `the auth of ${name}`)
      const b = obj(r.body)
      const mode = text(b.mode)
      let body: { format?: 'json' | 'text' | 'form'; text: string } | undefined
      if (mode === 'json') body = { format: 'json', text: text(b.json) }
      else if (mode === 'text' || mode === 'xml') body = { format: 'text', text: text(b[mode]) }
      else if (mode === 'formUrlEncoded')
        body = {
          format: 'form',
          text: list(b.formUrlEncoded)
            .map(obj)
            .filter((p) => p.enabled !== false)
            .map((p) => `${encodeURIComponent(text(p.name))}=${encodeURIComponent(text(p.value))}`)
            .join('&'),
        }
      else if (mode && mode !== 'none') {
        skipped.push(`${name}: a ${mode} body`)
        continue
      }
      const params = list(r.params)
        .map(obj)
        .filter((p) => p.type !== 'path' && p.enabled !== false)
        .map((p) => `${encodeURIComponent(text(p.name))}=${encodeURIComponent(text(p.value))}`)
      const base = text(r.url).split('?')[0]!
      requests.push(
        ...build(
          name,
          text(r.method),
          base + (params.length ? `?${params.join('&')}` : ''),
          headersOf(list(r.headers), leftOut),
          body,
          folder,
          skipped
        )
      )
    }
  }
  walk(list(doc.items), undefined)
  return { collection: text(doc.name) || 'Imported', requests, vars: env, leftOut, skipped }
}
