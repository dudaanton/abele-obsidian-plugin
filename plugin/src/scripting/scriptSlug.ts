/**
 * The ASCII handle a script's name becomes: its command id and its tool name.
 *
 * Both have to be ASCII — Obsidian's command ids by convention, a provider's tool names by
 * rule (`[a-zA-Z0-9_-]`) — and both used to be made by dropping everything else. A name in
 * Cyrillic dropped to nothing, so every such script registered the same command,
 * `abele:script-`, and the same tool, `script_`: the palette showed whichever was read last,
 * which changed from launch to launch («вот этот скрипт не вижу», 2026-09-05). Cyrillic is
 * transliterated instead, and a name that still comes to nothing gets a hash of itself, so
 * two scripts never share a handle for want of Latin letters. A Latin name comes out exactly
 * as before, so no existing hotkey or tool mode moves.
 */

const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  є: 'ye',
  і: 'i',
  ї: 'yi',
  ґ: 'g',
}

/** FNV-1a over the name, as eight hex digits: stable, short, and different for different names. */
function hash(name: string): string {
  let h = 0x811c9dc5
  for (const ch of name) {
    for (const byte of new TextEncoder().encode(ch)) {
      h ^= byte
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return h.toString(16).padStart(8, '0')
}

export function scriptSlug(name: string): string {
  const latin = name.toLowerCase().replace(/[а-яёєіїґ]/g, (ch) => CYRILLIC[ch] ?? ch)
  const slug = latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || `x${hash(name)}`
}
