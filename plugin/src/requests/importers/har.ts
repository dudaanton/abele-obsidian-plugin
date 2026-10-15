// A HAR file a browser saved: one request per entry. The origin most of them go to becomes the
// environment's `base`; cookies and session headers are left out and named.
import type { Pair } from '../wire'
import {
  bodyFormat,
  credential,
  isMethod,
  leave,
  request,
  splitQuery,
  type Imported,
} from './shared'

interface HarRequest {
  method?: string
  url?: string
  headers?: { name?: string; value?: string }[]
  queryString?: { name?: string; value?: string }[]
  postData?: { mimeType?: string; text?: string; params?: { name?: string; value?: string }[] }
}

const SKIP = /^(:.*|content-length|host|connection|accept-encoding)$/i

export function importHar(value: { log: { entries: { request?: HarRequest }[] } }): Imported {
  const leftOut: string[] = []
  const entries = value.log.entries.map((e) => e.request).filter((r): r is HarRequest => !!r?.url)
  const origins = new Map<string, number>()
  for (const r of entries) {
    try {
      const o = new URL(r.url!).origin
      origins.set(o, (origins.get(o) ?? 0) + 1)
    } catch {
      // An address that is not one stays as written.
    }
  }
  const base = [...origins].sort((a, b) => b[1] - a[1])[0]?.[0]
  const requests = entries.map((r) => {
    const { url: whole } = splitQuery(r.url!)
    const url = base && whole.startsWith(base) ? `{{base}}${whole.slice(base.length)}` : whole
    const headers: Pair[] = []
    for (const h of r.headers ?? []) {
      const key = h.name ?? ''
      if (!key || SKIP.test(key)) continue
      if (credential(key, h.value ?? '')) leave(leftOut, key)
      else headers.push({ key, value: h.value ?? '' })
    }
    const params = (r.queryString ?? []).map((q) => ({ key: q.name ?? '', value: q.value ?? '' }))
    const text =
      r.postData?.text ??
      (r.postData?.params ?? [])
        .map((p) => `${encodeURIComponent(p.name ?? '')}=${encodeURIComponent(p.value ?? '')}`)
        .join('&')
    const method = (r.method ?? 'GET').toUpperCase()
    let path = whole
    try {
      path = new URL(whole).pathname
    } catch {
      // As written.
    }
    return {
      doc: request({
        name: `${method} ${path}`,
        method: isMethod(method) ? method : 'GET',
        url,
        params,
        headers,
        ...(text ? { body: { format: bodyFormat(headers, text), text } } : {}),
      }),
    }
  })
  return {
    collection: 'Imported',
    requests,
    vars: base ? [{ key: 'base', value: base }] : [],
    leftOut,
  }
}
