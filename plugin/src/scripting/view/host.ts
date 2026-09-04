/**
 * Where a View finds the thing that owns leaves.
 *
 * The script context needs a host to build a View, the service that is the host needs the
 * ScriptService to re-run scripts, and the ScriptService builds the context: a cycle of
 * imports. The service registers itself here when it starts, and the context asks here.
 */
import type { ViewHost } from './View'

let current: ViewHost | null = null

export function setDefaultViewHost(host: ViewHost | null): void {
  current = host
}

export function defaultViewHost(): ViewHost {
  if (!current) throw new Error('No view host is registered')
  return current
}
