export interface ConsentCleanupStage {
  name: string
  run(): unknown | Promise<unknown>
}

/** Attempt each owned cleanup once, retaining first failure and secondary diagnostics. */
export async function consentCleanupStages(stages: ConsentCleanupStage[]): Promise<void> {
  let first: unknown
  let failed = false
  const secondary: Array<{ stage: string; message: string }> = []
  for (const stage of stages) {
    try {
      await stage.run()
    } catch (error) {
      if (!failed) {
        first = error
        failed = true
      } else
        secondary.push({
          stage: stage.name,
          message: error instanceof Error ? error.message : String(error),
        })
    }
  }
  if (secondary.length)
    console.warn('Secondary consent cleanup failures', JSON.stringify(secondary))
  if (failed) throw first
}
