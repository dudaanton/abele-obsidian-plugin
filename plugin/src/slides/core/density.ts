import { stripCssComments } from '@/scripting/view/cssSyntax'

export interface DensityWarning {
  kind:
    | 'words'
    | 'bullets'
    | 'table-rows'
    | 'table-columns'
    | 'links'
    | 'raw-url'
    | 'css-font'
    | 'css-color'
  message: string
}

/** Authoring guidance on the audience's rendered body, separate from measured fit errors. */
export function checkSlideDensity(slide: HTMLElement): DensityWarning[] {
  const body = slide.querySelector<HTMLElement>('.abele-slide-content')
  if (!body) return []
  const warnings: DensityWarning[] = []
  const text = body.cloneNode(true) as HTMLElement
  text.querySelectorAll('h1, h2, h3, h4, h5, h6, script, style').forEach((el) => el.remove())
  // Keep adjacent table cells/list items distinct even when the renderer adds no whitespace.
  text.querySelectorAll('p, li, td, th, pre, div').forEach((el) => el.append(' '))
  const words = text.textContent?.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  if (words > 40)
    warnings.push({ kind: 'words', message: `${words} body words; aim for at most 40` })
  const bullets = body.querySelectorAll('li').length
  if (bullets > 5)
    warnings.push({ kind: 'bullets', message: `${bullets} list items; aim for at most 5` })
  for (const [index, table] of Array.from(body.querySelectorAll('table')).entries()) {
    const rows = Array.from(table.rows)
    const dataRows = rows.filter(
      (r) => !r.closest('thead') && !Array.from(r.cells).every((c) => c.tagName === 'TH')
    ).length
    const columns = Math.max(
      0,
      ...rows.map((r) => Array.from(r.cells).reduce((n, c) => n + c.colSpan, 0))
    )
    if (dataRows > 5)
      warnings.push({
        kind: 'table-rows',
        message: `Table ${index + 1}: ${dataRows} data rows; aim for at most 5`,
      })
    if (columns > 3)
      warnings.push({
        kind: 'table-columns',
        message: `Table ${index + 1}: ${columns} columns; aim for at most 3`,
      })
  }
  const links = body.querySelectorAll('a[href], a[data-href]').length
  if (links > 2)
    warnings.push({ kind: 'links', message: `${links} body links; move sources to speaker notes` })
  if (/https?:\/\/\S+/i.test(body.textContent ?? ''))
    warnings.push({
      kind: 'raw-url',
      message: 'Visible URL text; move sources to speaker notes and use short link labels',
    })
  return warnings
}

/** A heuristic, not CSS validation. It never blocks or changes a requested custom theme. */
export function checkDeckCss(css: string): DensityWarning[] {
  const warnings: DensityWarning[] = []
  const clean = stripCssComments(css)
  if (/(?:^|[;{])\s*font-family\s*:/i.test(clean))
    warnings.push({
      kind: 'css-font',
      message:
        'Deck CSS sets font-family; use the Obsidian font unless custom styling was requested',
    })
  const declarations = Array.from(clean.matchAll(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;}]+)/g))
  const literal = declarations.some(([, property, value]) => {
    const withoutVariables = value.replace(/var\([^)]*\)/g, '')
    if (
      /#(?:[\da-f]{3,8})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i.test(
        withoutVariables
      )
    )
      return true
    if (
      !/^(?:.*color|background(?:-image)?|border(?:-(?:top|right|bottom|left))?|fill|stroke|(?:box|text)-shadow)$/i.test(
        property
      )
    )
      return false
    const tokens =
      withoutVariables
        .replace(/url\([^)]*\)/g, '')
        .replace(/[\w-]+(?=\()/g, '')
        .replace(/[-+]?[\d.]+(?:[a-z]+|%)?/gi, '')
        .replace(/!important/g, '')
        .match(/[a-z][\w-]*/gi) ?? []
    return tokens.some(
      (token) =>
        !/^(?:none|transparent|currentColor|inherit|initial|unset|revert(?:-layer)?|solid|dashed|dotted|double|groove|ridge|inset|outset|to|top|right|bottom|left|center|cover|contain|repeat|no-repeat|fixed|scroll|local)$/i.test(
          token
        )
    )
  })
  if (literal)
    warnings.push({
      kind: 'css-color',
      message:
        'Deck CSS sets literal colours/backgrounds; use Obsidian theme variables unless custom styling was requested',
    })
  return warnings
}
