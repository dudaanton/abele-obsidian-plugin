/**
 * How the calendars reach the network: Obsidian's `requestUrl`, which no CORS rule stands in
 * front of and which works the same on a phone. Behind a function of its own so tests can send
 * the same requests to a server they start themselves.
 */
import { requestUrl } from 'obsidian'

export interface HttpRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface HttpResponse {
  status: number
  text: string
  headers: Record<string, string>
}

export type Requester = (request: HttpRequest) => Promise<HttpResponse>

export const obsidianRequester: Requester = async (request) => {
  const response = await requestUrl({ ...request, throw: false })
  let text = ''
  try {
    text = response.text
  } catch {
    // A body that is not text — nothing a calendar would send; the status says what happened.
  }
  return { status: response.status, text, headers: response.headers ?? {} }
}

/** A header whatever case the server wrote it in. */
export function header(response: HttpResponse, name: string): string {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return ''
}

/** `Basic …` for a login and password, UTF-8 as RFC 7617 asks. */
export function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

/** What a refused or failed request means, in words for the settings screen. */
export function statusMessage(status: number, what: 'link' | 'server'): string {
  if (status === 401 || status === 403) {
    return what === 'link'
      ? `The calendar refused the link (${status}). It may have been reset; copy it again.`
      : `The server did not accept the username and password (${status}). For iCloud, use an app-specific password.`
  }
  if (status === 404 || status === 410) {
    return what === 'link'
      ? `There is no calendar at this link any more (${status}).`
      : `The server has no calendar at this address (${status}).`
  }
  if (status >= 500) return `The calendar's server failed (${status}); it is tried again later.`
  return `The calendar answered ${status}.`
}
