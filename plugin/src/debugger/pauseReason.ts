import { z } from 'zod'

/** Validation libraries serialize their issues into the exception message. Keep the useful
 * messages in the status rather than presenting the protocol-shaped JSON as prose. */
export function pauseReason(description: string | undefined): string | undefined {
  if (!description) return description
  const structured = /^([^:\n]+):\s*(\[[\s\S]*\])$/.exec(description)
  if (!structured) return description
  try {
    const issues = z
      .array(z.object({ message: z.string().min(1) }))
      .nonempty()
      .safeParse(JSON.parse(structured[2]))
    if (issues.success)
      return `${structured[1]}: ${[...new Set(issues.data.map((issue) => issue.message))].join('; ')}`
  } catch {
    // Ordinary exception messages need not contain JSON.
  }
  return description
}
