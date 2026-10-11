import path from 'node:path'
import ts from 'typescript'

interface CommandAnalysis {
  readonly source: string
  readonly objectLiteral: boolean
  readonly hasName: boolean
  readonly expression: string
  readonly names: readonly { readonly literal: boolean; readonly value: string }[]
}

// Only immutable summaries are shared. Callers cannot mutate the compiler's AST or checker.
const summaries = new WeakMap<ts.Program, Map<string, readonly CommandAnalysis[]>>()
export function analyzeCommands(
  program: ts.Program,
  sourceRoot: string
): readonly CommandAnalysis[] {
  const previous = summaries.get(program)?.get(sourceRoot)
  if (previous) return previous
  let checker: ts.TypeChecker | undefined
  const entries: CommandAnalysis[] = []
  for (const source of program.getSourceFiles()) {
    if (!source.fileName.startsWith(sourceRoot) || source.isDeclarationFile) continue
    // A token prefilter only avoids walking unrelated ASTs; type resolution remains exact.
    // Escaped identifiers can spell addCommand without that literal substring.
    if (!source.text.includes('addCommand') && !source.text.includes('\\u')) continue
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'addCommand'
      ) {
        const command = node.arguments[0]
        const objectLiteral = !!command && ts.isObjectLiteralExpression(command)
        const name = objectLiteral
          ? command.properties.find((p) => p.name?.getText(source) === 'name')
          : undefined
        const hasName = !!name && ts.isPropertyAssignment(name)
        const value = hasName ? name.initializer : undefined
        const expression = value?.getText(source) ?? ''
        let names: Array<{ literal: boolean; value: string }> = []
        if (value) {
          if (ts.isTemplateExpression(value) && expression === '`Script: ${parsed.meta.name}`') {
            names = [{ literal: true, value: 'Script: <name>' }]
          } else {
            checker ??= program.getTypeChecker()
            const type = checker.getTypeAtLocation(value)
            names = (type.isUnion() ? type.types : [type]).map((candidate) => ({
              literal: candidate.isStringLiteral(),
              value: candidate.isStringLiteral() ? candidate.value : '',
            }))
          }
        }
        entries.push(
          Object.freeze({
            source: source.fileName,
            objectLiteral,
            hasName,
            expression,
            names: Object.freeze(names.map((name) => Object.freeze(name))),
          })
        )
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  const result = Object.freeze(entries)
  const byRoot = summaries.get(program) ?? new Map()
  byRoot.set(sourceRoot, result)
  summaries.set(program, byRoot)
  return result
}

let project: readonly CommandAnalysis[] | undefined
export function projectCommands(): readonly CommandAnalysis[] {
  if (project) return project
  const root = path.resolve(import.meta.dirname, '../..')
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  if (parsed.errors.length) throw new Error('Invalid command-analysis compiler configuration')
  project = analyzeCommands(
    ts.createProgram(parsed.fileNames, parsed.options),
    path.join(root, 'src/')
  )
  return project
}
