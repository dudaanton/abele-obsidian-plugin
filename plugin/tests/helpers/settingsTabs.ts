import ts from 'typescript'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { en } from '@/i18n/locales/en/pilot'

function requireShape(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Settings tab source: ${message}`)
}

/** Read every declared tab; unsupported shapes and unknown catalog keys fail instead of skipping. */
export function settingsTabsFromSource(source: string): (readonly [string, string])[] {
  const script = parseSfc(source).descriptor.scriptSetup
  requireShape(script, 'missing setup script')
  const ast = ts.createSourceFile('Settings.ts', script.content, ts.ScriptTarget.Latest, true)
  let tabs: (readonly [string, string])[] | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'tabs') {
      requireShape(tabs === undefined, 'multiple tab arrays')
      const array = node.initializer
      requireShape(array && ts.isArrayLiteralExpression(array), 'expected a tab array')
      tabs = array.elements.map((entry) => {
        requireShape(ts.isObjectLiteralExpression(entry), 'expected a tab object')
        const field = (name: string) =>
          entry.properties.find(
            (prop): prop is ts.PropertyAssignment =>
              ts.isPropertyAssignment(prop) && prop.name.getText(ast) === name
          )?.initializer
        const id = field('id')
        const label = field('label')
        requireShape(id && ts.isStringLiteral(id), 'expected a literal tab ID')
        if (label && ts.isStringLiteral(label)) return [id.text, label.text] as const
        requireShape(label && ts.isCallExpression(label), `expected a label for ${id.text}`)
        requireShape(label.expression.getText(ast) === 't', `expected t() for ${id.text}`)
        requireShape(label.arguments.length === 1, `expected one label key for ${id.text}`)
        const key = label.arguments[0]
        requireShape(ts.isStringLiteral(key), `expected a literal label key for ${id.text}`)
        requireShape(Object.hasOwn(en, key.text), `unknown English key ${key.text}`)
        const english = en[key.text as keyof typeof en]
        requireShape(typeof english === 'string', `expected a text label for ${id.text}`)
        return [id.text, english] as const
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  requireShape(tabs, 'missing tab array')
  return tabs
}
