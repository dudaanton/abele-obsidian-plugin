import { GlobalStore } from '@/stores/GlobalStore'
import { isLocalAddress, isLoopback } from '@/helpers/networkAddress'
import { httpOrigin } from './DestinationPolicy'

const STORAGE_KEY = 'abele-key-http-origins-v1'
export function allowedHttpOrigins(): string[] {
  const raw = GlobalStore.getInstance().app?.loadLocalStorage(STORAGE_KEY)
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
}
export function canAllowHttp(raw: string): boolean {
  const origin = httpOrigin(raw)
  if (!origin) return false
  const url = new URL(origin)
  return url.protocol === 'http:' && isLocalAddress(url.hostname) && !isLoopback(url.hostname)
}
export function allowHttpOrigin(raw: string): void {
  if (!canAllowHttp(raw)) throw new Error('Only a home-network HTTP address can be allowed')
  const origin = httpOrigin(raw)!
  GlobalStore.getInstance().app.saveLocalStorage(STORAGE_KEY, [
    ...new Set([...allowedHttpOrigins(), origin]),
  ])
}
export function forgetHttpOrigin(origin: string): void {
  GlobalStore.getInstance().app.saveLocalStorage(
    STORAGE_KEY,
    allowedHttpOrigins().filter((entry) => entry !== origin)
  )
}
export function checkKeyTransport(raw: string): void {
  const origin = httpOrigin(raw)
  if (!origin) throw new Error('Keys require an HTTP(S) address without URL credentials')
  const url = new URL(origin)
  if (url.protocol === 'https:' || isLoopback(url.hostname)) return
  if (canAllowHttp(origin) && allowedHttpOrigins().includes(origin)) return
  throw new Error(
    `Keys are not sent over unencrypted HTTP to ${url.host}. Use HTTPS, or allow a home-network address in Review key destinations.`
  )
}
