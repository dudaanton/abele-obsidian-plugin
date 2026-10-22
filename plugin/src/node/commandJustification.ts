import { z } from 'zod'

/** Display-only agent prose; never part of the executable command. */
export const commandJustification = z
  .string()
  .max(200)
  .transform((value) =>
    value
      .replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
  .pipe(z.string().min(1))
