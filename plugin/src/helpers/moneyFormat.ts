/**
 * Writing an amount out, the one way the whole plugin does it.
 *
 * Every screen that shows money used to carry its own copy of one `toLocaleString` call, and
 * they all had the same hole in them: a zero with a minus sign. An account whose transactions
 * cancel out does not land on zero but on a crumb like -1.4e-14 — the ordinary residue of
 * adding and subtracting the same money in floating point — and two decimal places of that is
 * `-0.00`, which reads as a balance in the red. Javascript's own `-0` prints its sign too.
 */
export const AMOUNT_DECIMALS = 2

export function formatAmount(value: number, decimals: number = AMOUNT_DECIMALS): string {
  // Rounded to what will be shown before the sign is asked about, so that a number which is
  // only negative below the last visible digit is the zero it means. Adding zero is what turns
  // the -0 that rounding leaves behind into a plain one.
  const shown = Number(value.toFixed(decimals)) + 0

  return shown.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
