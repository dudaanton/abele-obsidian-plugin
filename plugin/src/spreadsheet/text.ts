import { escapeXml, validXmlCharacter } from '@/ooxml/xml'
/** ST_Xstring escapes are decoded once: an escaped underscore protects a literal escape token. */
export const decodeSpreadsheetText = (text: string) =>
  text.replace(/_x([0-9a-f]{4})_/gi, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)))
export function escapeSpreadsheetText(text: string): string {
  const protectedText = text.replace(/_x[0-9a-f]{4}_/gi, (token) => '_x005F_' + token.slice(1))
  let encoded = ''
  for (const character of protectedText) {
    const point = character.codePointAt(0)!
    if (point >= 0xd800 && point <= 0xdfff) throw new Error('Invalid spreadsheet string surrogate')
    encoded +=
      point === 13 || !validXmlCharacter(point)
        ? `_x${point.toString(16).toUpperCase().padStart(4, '0')}_`
        : character
  }
  return escapeXml(encoded)
}
