import { cssTokens, decodeCssEscapes, stripCssComments } from '@/scripting/view/cssSyntax'
import type { CssImportLoader, CssSource } from './model'

interface ImportRule {
  start: number
  end: number
  reference: string
  qualifiers: string
}

/** Resolve the stylesheet graph *before* scopeCss. No raw import may reach a style element,
 * including failed, cyclic, escaped or malformed imports. Other usable rules remain intact. */
export async function expandCssImports(source: CssSource, load?: CssImportLoader): Promise<string> {
  const cache = new Map<string, Promise<CssSource>>()
  const expand = async (sheet: CssSource, ancestors: Set<string>): Promise<string> => {
    const css = stripCssComments(sheet.css)
    const imports = importRules(css)
    let out = '',
      from = 0
    for (const rule of imports) {
      out += rebaseAssets(css.slice(from, rule.start), sheet.assetUrl)
      from = rule.end
      if (!rule.reference || !load) {
        console.warn('[Abele] presentation CSS import could not be resolved')
        continue
      }
      try {
        const key = `${sheet.id}\n${rule.reference}`
        let pending = cache.get(key)
        if (pending === undefined) {
          pending = load(rule.reference, sheet.id)
          cache.set(key, pending)
        }
        const imported = await pending
        if (ancestors.has(imported.id)) continue
        const body = await expand(imported, new Set([...ancestors, imported.id]))
        out += wrapImport(body, rule.qualifiers) + '\n'
      } catch (error) {
        console.warn('[Abele] presentation CSS import could not be loaded', error)
      }
    }
    return out + rebaseAssets(css.slice(from), sheet.assetUrl)
  }
  return expand(source, new Set([source.id]))
}

function importRules(css: string): ImportRule[] {
  const rules: ImportRule[] = []
  let start = 0,
    parentheses = 0,
    brackets = 0
  const add = (end: number) => {
    const statement = css.slice(start, end).trim().replace(/;\s*$/, '')
    const keyword = /^@((?:\\[0-9a-f]{1,6}[ \t\r\n\f]?|\\[^\r\n\f]|[\w-])+)\s*/i.exec(statement)
    if (!keyword || decodeCssEscapes(keyword[1]).toLowerCase() !== 'import') return
    // Decode only identifiers and URL values. Decoding qualifiers would turn escaped layer
    // names into real braces/semicolons when interpolated into a wrapper's CSS structure.
    const tail = statement.slice(keyword[0].length)
    const match =
      /^(?:url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*([\s\S]*)$/i.exec(
        tail
      )
    rules.push({
      start,
      end,
      reference: decodeCssEscapes(
        match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4] ?? match?.[5] ?? ''
      ).trim(),
      qualifiers: match?.[6] ?? '',
    })
  }
  for (const { index, char } of cssTokens(css)) {
    if (char === '(') parentheses++
    else if (char === ')') parentheses--
    else if (char === '[') brackets++
    else if (char === ']') brackets--
    else if (parentheses === 0 && brackets === 0 && [';', '{', '}'].includes(char)) {
      if (char === ';') add(index + 1)
      start = index + 1
    }
  }
  add(css.length) // A final import without a semicolon is valid CSS too.
  return rules
}

function functionEnd(text: string, open: number): number {
  let depth = 0
  for (const { index, char } of cssTokens(text.slice(open))) {
    if (char === '(') depth++
    else if (char === ')' && --depth === 0) return open + index
  }
  return -1
}

function wrapImport(css: string, qualifiers: string): string {
  let rest = qualifiers.trim()
  const wrappers: string[] = []
  const layer = /^layer\b(?:\(\s*([^)]*)\))?\s*/i.exec(rest)
  if (layer) {
    wrappers.push(`@layer${layer[1]?.trim() ? ' ' + layer[1].trim() : ''}`)
    rest = rest.slice(layer[0].length).trim()
  }
  if (/^supports\s*\(/i.test(rest)) {
    const open = rest.indexOf('('),
      close = functionEnd(rest, open)
    if (close < 0) return ''
    wrappers.push(`@supports (${rest.slice(open + 1, close)})`)
    rest = rest.slice(close + 1).trim()
  }
  if (rest) wrappers.push(`@media ${rest}`)
  return wrappers.reduceRight((body, head) => `${head} {\n${body}\n}`, css)
}

/** Imported image/font URLs keep the imported file's base, not the Obsidian window's base. */
function rebaseAssets(css: string, resolve?: (reference: string) => string): string {
  if (!resolve) return css
  let out = '',
    from = 0
  for (const { index } of cssTokens(css)) {
    if (index < from || !/^url\s*\(/i.test(css.slice(index)) || /[\w-]/.test(css[index - 1] ?? ''))
      continue
    const open = css.indexOf('(', index),
      close = functionEnd(css, open)
    if (close < 0) continue
    const value = css.slice(open + 1, close).trim()
    const reference = decodeCssEscapes(/^['"]/.test(value) ? value.slice(1, -1) : value)
    const url = resolve(reference)
    out += css.slice(from, index) + `url("${url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`
    from = close + 1
  }
  return out + css.slice(from)
}
