import { z } from 'zod'
import type { NodeClient } from '@abele/node-client'

const path = z.string().min(1).max(4096)
const TargetsSchema = z.object({
  targets: z
    .array(
      z.object({
        program: path,
        source: path.optional(),
        npm_script: z.string().min(1).max(256).optional(),
      })
    )
    .max(4096),
})
export type ProgramLaunchTarget = z.infer<typeof TargetsSchema>['targets'][number]
const MethodErrorSchema = z.object({ code: z.string().optional(), message: z.string().optional() })
export const launchTargetName = (target: ProgramLaunchTarget) =>
  target.npm_script ? `npm run ${target.npm_script}` : (target.source ?? target.program)

export function programLaunchPaths(
  targets: ProgramLaunchTarget[],
  files: string[],
  open: string[] = []
): string[] {
  // Source aliases stay searchable without filling the first screen ahead of runnable entries.
  return [
    ...new Set([
      ...open,
      ...targets.filter((t) => t.npm_script).map(launchTargetName),
      ...targets.filter((t) => !t.npm_script).map((t) => t.program),
      ...targets.map(launchTargetName),
      ...files,
    ]),
  ]
}

/** Optional discovery: the node can see ignored builds and read their maps; the client cannot. */
export async function programLaunchTargets(client: NodeClient, owner: object) {
  try {
    return TargetsSchema.parse(await client.request('debugger.v1.launchTargets', owner)).targets
  } catch (error) {
    const failure = MethodErrorSchema.safeParse(error)
    if (
      failure.success &&
      /unsupported_method|unknown_method|method_not_found/.test(
        `${failure.data.code ?? ''} ${failure.data.message ?? ''}`
      )
    ) {
      console.debug('[debugger] Launch catalogue unavailable; using filename search')
      return []
    }
    throw error
  }
}

export function resolveLaunchTarget(name: string, targets: ProgramLaunchTarget[]) {
  const target = targets.find(
    (t) => launchTargetName(t) === name || (!t.npm_script && t.program === name)
  )
  return {
    program: target?.program ?? name,
    sources: target?.source ? [target.source] : [],
    ...(target?.npm_script ? { npm_script: target.npm_script } : {}),
  }
}
