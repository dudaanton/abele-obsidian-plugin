// Requests brought in from other clients: a `.http` file, a curl line, a HAR file, an OpenAPI
// description or a Bruno request. The format is read off the text; credentials never come along.
import yaml from 'js-yaml'
import { importBruno } from './bruno'
import { importCurl } from './curl'
import { importHar } from './har'
import { importHttp } from './http'
import { importOpenApi } from './openapi'
import { scrubSecrets, type Imported } from './shared'

export type { Imported, ImportedRequest } from './shared'
export type ImportFormat = 'http' | 'curl' | 'har' | 'openapi' | 'bruno'

function parsed(text: string): unknown {
  const t = text.trim()
  try {
    return t.startsWith('{')
      ? JSON.parse(t)
      : /^(openapi|swagger)\s*:/m.test(t)
        ? yaml.load(t)
        : undefined
  } catch {
    return undefined
  }
}

export function detectFormat(text: string): ImportFormat | undefined {
  const t = text.trim()
  const value = parsed(t) as Record<string, unknown> | undefined
  if (value && typeof value === 'object') {
    const log = value.log as { entries?: unknown } | undefined
    if (Array.isArray(log?.entries)) return 'har'
    if ('openapi' in value || 'swagger' in value) return 'openapi'
  }
  if (/^curl\s/.test(t)) return 'curl'
  if (/^(meta|get|post|put|patch|delete|head|options)\s*\{\s*$/m.test(t)) return 'bruno'
  if (/^###/m.test(t) || /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S/m.test(t)) return 'http'
  return undefined
}

export function importRequests(text: string, format = detectFormat(text)): Imported {
  return scrubSecrets(readAs(text, format))
}

function readAs(text: string, format: ImportFormat | undefined): Imported {
  switch (format) {
    case 'http':
      return importHttp(text)
    case 'curl':
      return importCurl(text)
    case 'har':
      return importHar(parsed(text) as Parameters<typeof importHar>[0])
    case 'openapi':
      return importOpenApi(parsed(text) as Record<string, unknown>)
    case 'bruno':
      return importBruno(text)
    default:
      throw new Error(
        'Not a .http file, a curl line, a HAR file, an OpenAPI description or a Bruno request'
      )
  }
}
