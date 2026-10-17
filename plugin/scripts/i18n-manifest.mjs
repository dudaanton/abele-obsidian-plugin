import ts from 'typescript'
import { parse } from '@vue/compiler-sfc'
import { baseParse, NodeTypes } from '@vue/compiler-dom'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const presentation =
  /^(?:label|display|title|text|description|desc|placeholder|tooltip|name|heading|message|emptyText|confirmText|submitText|cancelTooltip|confirmTooltip|submitTooltip|detailsLabel|overflowLabel|disabledReason|aria-label|aria-description|text-right|disabled-reason|replace-placeholder|save-tooltip|more-label|what|data-tip|confirm-tooltip|cancel-tooltip|submit-tooltip|confirm-text|submit-text|details-label|overflow-label|empty-text)$/
const sinks =
  /^(?:Notice|setTitle|setName|setDesc|setText|setTooltip|setPlaceholder|createEl|createDiv|createSpan|addCommand|setAttribute)$/
const readable = (text) => /[\p{L}]/u.test(text) && !/^\s*$/.test(text)

export function areaFor(path) {
  const parts = path.split('/')
  if (parts[0] === 'components') {
    const folder = parts[1]
    if (folder === 'obsidian') return 'shared-kit'
    if (folder === 'settings') return 'settings'
    if (/^(?:Ai|Chat|Agent|ToolModes)/.test(folder) || ['chat', 'chatOutline'].includes(folder))
      return 'chat'
    if (/^(?:Task|Todo|TimeEntry|TimeTracking|ElapsedTime)/.test(folder)) return 'tasks-time'
    if (/^(?:Node|node)/.test(folder)) return 'node'
    if (
      /^(?:Calendar|TasksCalendar|LogsCalendar|DateTime)/.test(folder) ||
      ['calendarBase', 'timelineBase'].includes(folder)
    )
      return 'calendar'
    return parts.length > 2 ? folder : 'shared-ui'
  }
  if (['ai', 'agents'].includes(parts[0])) return 'chat'
  if (['sync', 'transfer'].includes(parts[0])) return 'sync-transfer'
  if (['commands', 'startup'].includes(parts[0]) || path === 'main.ts') return 'commands-startup'
  return parts[0]
}

/** Candidate inventory, not a claim of complete dataflow analysis. Context is retained for review. */
export function extract(path, source) {
  const found = []
  const add = (text, context, line) => {
    if (readable(text))
      found.push({
        path,
        area: areaFor(path),
        line,
        context,
        text,
        hash: createHash('sha256')
          .update(context + '\0' + text)
          .digest('hex'),
      })
  }
  function script(code, offset = 0, expression = false) {
    const ast = ts.createSourceFile(path + '.ts', code, ts.ScriptTarget.Latest, true)
    const literals = (node, context) => {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 't') return
      if (
        ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
        ].includes(node.operatorToken.kind)
      )
        return
      if (ts.isPropertyAssignment(node)) {
        if (presentation.test(node.name.getText(ast).replace(/^['"]|['"]$/g, '')))
          literals(node.initializer, context)
        return
      }
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        add(
          node.text,
          context,
          offset + ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
        )
        return
      }
      ts.forEachChild(node, (child) => literals(child, context))
    }
    function visit(node) {
      if (
        ts.isVariableDeclaration(node) &&
        /^(labels|messages|stateText|options|tabs|GROUPS|.*(?:Labels|Names|Options)|.*_(?:LABELS|NAMES|OPTIONS))$/.test(
          node.name.getText(ast)
        ) &&
        node.initializer
      ) {
        const map = node.initializer
        if (ts.isObjectLiteralExpression(map))
          for (const prop of map.properties)
            if (ts.isPropertyAssignment(prop))
              literals(prop.initializer, 'label-map:' + node.name.getText(ast))
      }
      if (
        ts.isPropertyAssignment(node) &&
        presentation.test(node.name.getText(ast).replace(/^['"]|['"]$/g, ''))
      )
        literals(node.initializer, 'property:' + node.name.getText(ast))
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const name = node.expression.getText(ast).split('.').pop()
        if (sinks.test(name))
          for (const arg of node.arguments ?? []) {
            // Tag names, aria attribute names and icon identifiers are not prose.
            if (
              name === 'setAttribute' &&
              (arg === node.arguments[0] ||
                !['aria-label', 'aria-description', 'title', 'placeholder'].includes(
                  node.arguments[0]?.text
                ))
            )
              continue
            if (/^create/.test(name) && arg === node.arguments[0] && ts.isStringLiteral(arg))
              continue
            literals(arg, 'sink:' + name)
          }
      }
      ts.forEachChild(node, visit)
    }
    if (expression) literals(ast, 'binding')
    else visit(ast)
  }
  if (path.endsWith('.vue')) {
    const { descriptor } = parse(source)
    const template = descriptor.template
    if (template) {
      const tree = baseParse(template.content)
      function walk(node) {
        if (node.type === NodeTypes.TEXT)
          add(
            node.content.trim(),
            'template:text',
            template.loc.start.line + node.loc.start.line - 1
          )
        if (node.type === NodeTypes.INTERPOLATION)
          script(node.content.content, template.loc.start.line + node.loc.start.line - 2, true)
        for (const prop of node.props ?? []) {
          if (
            prop.type === NodeTypes.ATTRIBUTE &&
            presentation.test(prop.name) &&
            !(node.tag === 'slot' && prop.name === 'name') &&
            prop.value
          )
            add(
              prop.value.content,
              'attribute:' + prop.name,
              template.loc.start.line + prop.loc.start.line - 1
            )
          if (
            prop.type === NodeTypes.DIRECTIVE &&
            prop.exp &&
            (presentation.test(prop.arg?.content ?? '') || prop.arg?.content === 'options')
          )
            script(prop.exp.content, template.loc.start.line + prop.loc.start.line - 2, true)
        }
        for (const child of node.children ?? []) walk(child)
      }
      walk(tree)
    }
    for (const block of [descriptor.script, descriptor.scriptSetup])
      if (block) script(block.content, block.loc.start.line - 1)
  } else script(source)
  return found.filter(
    (entry, index, all) =>
      all.findIndex((other) => other.line === entry.line && other.text === entry.text) === index
  )
}

export function inventory(dir = join(root, 'src')) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return inventory(path)
    if (!/\.(ts|vue)$/.test(path) || path.endsWith('.d.ts')) return []
    const name = relative(join(root, 'src'), path).replaceAll('\\', '/')
    if (/^(?:i18n|testing|docs|vendor)\//.test(name) || /^ai\/(?:tools|prompts)\//.test(name))
      return []
    return extract(name, readFileSync(path, 'utf8'))
  })
}

export function checkMigrated(entries) {
  const policy = JSON.parse(readFileSync(join(root, 'src/i18n/migrated.json'), 'utf8'))
  const candidates =
    entries ??
    policy.files.flatMap((path) => extract(path, readFileSync(join(root, 'src', path), 'utf8')))
  return candidates
    .filter((entry) => policy.files.includes(entry.path))
    .filter(
      (entry) =>
        !policy.exceptions.some(
          (exception) => exception.path === entry.path && exception.text === entry.text
        )
    )
}

/** Command registration is migrated separately from each feature's menus and notices. */
export function checkCommandLabels() {
  const policy = JSON.parse(readFileSync(join(root, 'src/i18n/migrated.json'), 'utf8'))
  return (policy.commandFiles ?? []).flatMap((path) => {
    const source = readFileSync(join(root, 'src', path), 'utf8')
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
    const found = []
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        let label
        if (
          node.expression.name.text === 'addCommand' &&
          ts.isObjectLiteralExpression(node.arguments[0])
        )
          label = node.arguments[0].properties.find(
            (p) => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'name'
          )?.initializer
        if (node.expression.name.text === 'addRibbonIcon') label = node.arguments[1]
        if (label && !(ts.isCallExpression(label) && label.expression.getText(ast) === 't'))
          found.push({
            path,
            line: ast.getLineAndCharacterOfPosition(label.getStart(ast)).line + 1,
            text: label.getText(ast),
          })
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    return found
  })
}

/** Full-source ratchet: changed prose or a moved file cannot hide behind legacy debt. */
export function checkRatchet(entries = inventory()) {
  const baseline = JSON.parse(readFileSync(join(root, 'scripts/i18n-baseline.json'), 'utf8'))
  return entries.filter((entry) => {
    const index = baseline[entry.path]?.indexOf(entry.hash) ?? -1
    if (index < 0) return true
    baseline[entry.path].splice(index, 1)
    return false
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const guard = process.argv.includes('--check')
  const result = guard ? [...checkMigrated(), ...checkCommandLabels()] : inventory()
  console.log(JSON.stringify(result, null, 2))
  if (guard && result.length) process.exitCode = 1
}
