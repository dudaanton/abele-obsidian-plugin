import { parse as parseSfc } from '@vue/compiler-sfc'
import { baseParse, NodeTypes, type ElementNode, type TemplateChildNode } from '@vue/compiler-dom'
import ts from 'typescript'
import postcss from 'postcss'
import { compileString } from 'sass-embedded'

const DISCLOSURE_GLYPHS = /[▶▼▸▾►◀▲▽▴▵▿▹◂◃]/u
const HOST_TOKEN =
  /^--(?:size-(?:2-[0-8]|4-(?:[0-9]|10|11|12|16|18))|font-(?:interface|text|monospace|ui-(?:small|smaller|medium|large)|normal|medium|semibold)|line-height-(?:normal|tight)|text-(?:normal|muted|faint|accent|error|warning)|icon-(?:size|color|color-hover)|color-(?:red|orange|yellow|green|cyan|blue|purple|pink)|background-(?:primary|secondary|modifier-(?:border|border-focus|active-hover|hover))|interactive-accent|radius-[sm]|cursor(?:-link)?|touch-size-[sml]|abele-touch-min)$/
const hasProp = (node: ElementNode, name: string) =>
  node.props.some((p) =>
    p.type === NodeTypes.ATTRIBUTE
      ? p.name === name
      : p.name === 'bind' && p.arg?.type === NodeTypes.SIMPLE_EXPRESSION && p.arg.content === name
  )
const hasEvent = (node: ElementNode, name: string) =>
  node.props.some(
    (p) =>
      p.type === NodeTypes.DIRECTIVE &&
      p.name === 'on' &&
      p.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
      p.arg.content === name
  )

/** Real Vue/TS/CSS trees, not tag-name regexes. Narrow exceptions are supplied per file. */
export function inspectDesign(
  source: string,
  options: { screen?: boolean; touchPolicy?: boolean; qr?: boolean } = {}
): string[] {
  const errors: string[] = []
  const descriptor = parseSfc(source).descriptor
  const script = `${descriptor.script?.content ?? ''}\n${descriptor.scriptSetup?.content ?? ''}`
  const ast = ts.createSourceFile(
    'component.ts',
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const aliases = new Map<string, string>()
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const path = node.moduleSpecifier.text
      if (node.importClause?.name && path.endsWith('.vue'))
        aliases.set(node.importClause.name.text, path.split('/').pop()!.slice(0, -4))
    }
    if (ts.isStringLiteral(node) && DISCLOSURE_GLYPHS.test(node.text))
      errors.push('text disclosure glyph')
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (
        ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'format'].includes(
          node.expression.name.text
        )
      )
        errors.push('local display date')
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const walk = (node: TemplateChildNode) => {
    if (node.type === NodeTypes.TEXT && DISCLOSURE_GLYPHS.test(node.content))
      errors.push('text disclosure glyph')
    if (node.type === NodeTypes.INTERPOLATION && node.content.type === NodeTypes.SIMPLE_EXPRESSION)
      visit(
        ts.createSourceFile(
          'expression.ts',
          node.content.content,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS
        )
      )
    if (node.type !== NodeTypes.ELEMENT) return
    for (const prop of node.props) {
      if (
        prop.type === NodeTypes.ATTRIBUTE &&
        prop.value &&
        DISCLOSURE_GLYPHS.test(prop.value.content)
      )
        errors.push('text disclosure glyph')
      if (prop.type === NodeTypes.DIRECTIVE && prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION)
        visit(
          ts.createSourceFile(
            'expression.ts',
            prop.exp.content,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
          )
        )
    }
    const tag = aliases.get(node.tag) ?? node.tag
    if (hasProp(node, 'style')) errors.push('inline style')
    const classes = node.props.find((p) => p.type === NodeTypes.ATTRIBUTE && p.name === 'class')
    if (
      classes?.type === NodeTypes.ATTRIBUTE &&
      classes.value?.content.split(/\s+/).includes('clickable-icon') &&
      hasEvent(node, 'click') &&
      !['button', 'component'].includes(tag)
    )
      errors.push('nonsemantic icon action')
    if (
      options.screen &&
      ['div', 'span', 'p'].includes(tag) &&
      classes?.type === NodeTypes.ATTRIBUTE &&
      /(?:__|-)(?:meta(?:data)?|empty)(?:$|[_-])/.test(classes.value?.content ?? '')
    )
      errors.push('local metadata or empty-state composition')
    if (
      tag === 'Icon' &&
      (hasEvent(node, 'click') || hasProp(node, 'interactive')) &&
      !hasProp(node, 'tooltip') &&
      !hasProp(node, 'label') &&
      !hasProp(node, 'aria-label')
    )
      errors.push('unnamed icon action')
    if (
      options.screen &&
      node.props.some((p) => p.type === NodeTypes.DIRECTIVE && p.name === 'for') &&
      ['article', 'div', 'button', 'li'].includes(tag)
    )
      errors.push('raw flat object row')
    node.children.forEach(walk)
  }
  if (descriptor.template) baseParse(descriptor.template.content).children.forEach(walk)
  for (const style of descriptor.styles)
    errors.push(...inspectCss(style.content, { ...options, scss: style.lang === 'scss' }))
  return [...new Set(errors)]
}

export function inspectCss(
  css: string,
  options: { scss?: boolean; touchPolicy?: boolean; qr?: boolean; screen?: boolean } = {}
): string[] {
  const errors: string[] = []
  const root = postcss.parse(options.scss ? compileString(css, { style: 'expanded' }).css : css)
  if (options.screen)
    root.walkRules((rule) => {
      if (/(?:__|-)(?:meta(?:data)?|empty)(?:$|[_-]|\b)/.test(rule.selector))
        errors.push('local metadata or empty-state styling')
    })
  root.walkDecls((decl) => {
    const value = decl.value
    if (options.qr && ['fill', 'background-color'].includes(decl.prop)) return
    if (
      options.touchPolicy &&
      decl.prop === '--abele-touch-min' &&
      value === 'max(44px, var(--touch-size-m))'
    )
      return
    for (const match of value.matchAll(/var\((--[\w-]+)/g))
      if (!HOST_TOKEN.test(match[1])) errors.push(`unapproved token: ${match[1]}`)
    const literal = value
      .replace(/var\([^)]*\)/g, '')
      .replace(/(?:transparent|currentColor|inherit|initial|unset)/g, '')
    const colourLiteral = literal
      .replace(/\b(?:solid|dashed|dotted|none|inset|outset)\b/g, '')
      .replace(/-?\d+(?:\.\d+)?(?:px|em|rem|%)?/g, '')
    if (
      /^(?:color|background(?:-color)?|fill|stroke|box-shadow|outline|outline-color|border(?:-(?:top|right|bottom|left|inline-start|inline-end|block-start|block-end))?(?:-color)?)$/.test(
        decl.prop
      ) &&
      /#|rgba?\(|hsla?\(|\b[a-z]+\b/i.test(colourLiteral)
    )
      errors.push(`literal colour: ${decl.prop}`)
    if (
      /^font(?:-[\w-]+)?$|^line-height$/.test(decl.prop) &&
      !/^(?:inherit|normal|0)$/.test(value) &&
      !value.startsWith('var(')
    )
      errors.push(`literal typography: ${decl.prop}`)
    if (
      /^(?:padding|margin|gap|row-gap|column-gap)(?:-[\w-]+)?$/.test(decl.prop) &&
      /\d(?:px|em|rem|vh|vw|%)/.test(literal)
    )
      errors.push(`literal spacing: ${decl.prop}`)
    if (
      /\d+(?:\.\d+)?px/.test(literal) &&
      !(decl.prop.startsWith('border') && /^1px\s/.test(value))
    )
      errors.push(`literal length: ${decl.prop}`)
  })
  return [...new Set(errors)]
}
