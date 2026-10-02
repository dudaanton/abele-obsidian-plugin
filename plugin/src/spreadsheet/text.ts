import { escapeXml } from '@/ooxml/xml'
/** ST_Xstring escapes are decoded once: an escaped underscore protects a literal escape token. */
export const decodeSpreadsheetText = (text: string) =>
  text.replace(/_x([0-9a-f]{4})_/gi, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)))
export const escapeSpreadsheetText = (text: string) =>
  escapeXml(
    text
      .replace(/_x[0-9a-f]{4}_/gi, (token) => '_x005F_' + token.slice(1))
      .replaceAll('\r', '_x000D_')
  )
