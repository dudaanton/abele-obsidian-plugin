// The secrets of environments held in memory, a token taken from an answer most often: never
// written, blanked wherever they show, and each put only into requests to the origin it came from.
// One typed with no origin to go to is bound where a person first sends it; an agent's send never
// takes one that is not bound.
import { fill, varsOf } from './resolve'
import { SECRETS, originOf, type HeldSecret } from './shapes'
import type { EnvironmentDoc } from './wire'

export class HeldSecrets {
  constructor(private readonly projectId: string) {}

  private of(env: string): Record<string, HeldSecret> {
    const key = `${this.projectId}\n${env}`
    let s = SECRETS.get(key)
    if (!s) SECRETS.set(key, (s = {}))
    return s
  }

  values(env: string): Record<string, string> {
    return Object.fromEntries(Object.entries(this.of(env)).map(([k, h]) => [k, h.value]))
  }

  set(env: string, key: string, value: string, origin?: string) {
    this.of(env)[key] = { value, ...(origin ? { origin } : {}) }
  }

  forget(env: string) {
    SECRETS.delete(`${this.projectId}\n${env}`)
  }

  /** What was typed in the environment's dialog: kept here, bound to the environment's own `base`
   * when it has one; a secret taken out of the environment is forgotten. */
  remember(env: EnvironmentDoc) {
    const held = this.of(env.name)
    const plain = varsOf({ ...env, vars: env.vars.filter((v) => !v.secret) }, {})
    const base = plain.base ? originOf(fill(plain.base, plain)) : undefined
    for (const v of env.vars)
      if (v.secret && v.value !== undefined && held[v.key]?.value !== v.value)
        held[v.key] = { value: v.value, ...(base ? { origin: base } : {}) }
    for (const key of Object.keys(held))
      if (!env.vars.some((v) => v.secret && v.key === key)) delete held[key]
  }

  /** The secrets a request to this origin may take. */
  forTarget(env: string, to: string | undefined, person: boolean): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.of(env))
        .filter(
          ([, h]) => (h.origin !== undefined && h.origin === to) || (!h.origin && person && !!to)
        )
        .map(([k, h]) => [k, h.value])
    )
  }

  /** Why a variable a request needs is not there, when a secret holds it for somewhere else. */
  why(env: string, missing: string[]): string | undefined {
    const held = this.of(env)
    for (const name of missing) {
      const h = held[name]
      if (h?.origin) return `${name} is kept for ${h.origin} and is not sent anywhere else`
      if (h) return `${name} has not been sent anywhere yet: send this request once yourself first`
    }
    return undefined
  }

  /** Binds these secrets, not bound yet, to where a person sends them. */
  bind(env: string, keys: string[], to: string) {
    const held = this.of(env)
    for (const key of keys) if (held[key] && !held[key].origin) held[key].origin = to
  }
}
