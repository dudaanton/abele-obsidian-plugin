/**
 * How the calendars reach the network: Obsidian's `requestUrl`, which no CORS rule stands in
 * front of and which works the same on a phone. Behind a function of its own so tests can send
 * the same requests to a server they start themselves.
 */
import { requestText, headerValue } from '@/helpers/http'

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

export const obsidianRequester: Requester = (request) => requestText(request)

/** A header whatever case the server wrote it in. */
export function header(response: HttpResponse, name: string): string {
  return headerValue(response.headers, name) ?? ''
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
