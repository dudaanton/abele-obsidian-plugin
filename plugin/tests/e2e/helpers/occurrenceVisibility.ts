/** CSS computed colours may be RGB, RGBA or modern colour functions. */
export function transparentOccurrenceColor(color: string): boolean {
  return (
    !color ||
    color === 'transparent' ||
    (color.startsWith('rgba(') && color.endsWith(', 0)')) ||
    color.endsWith('/ 0)')
  )
}
