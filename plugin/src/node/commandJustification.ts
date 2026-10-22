import { z } from 'zod'

/** Historical display prose can exceed today's input limit; keep it readable in full. */
export const displayCommandJustification = (value: string) =>
  value
    .replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Display-only agent prose; never part of the executable command. */
export const commandJustification = z
  .string()
  .max(200)
  .transform(displayCommandJustification)
  .pipe(z.string().min(1))
