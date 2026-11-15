import ts from 'typescript'
import { SourceMapConsumer } from 'source-map-js'

// Only the verified external map identifies library code. Generated names and
// line-only breakpoints are ambiguous in an optimized single-file bundle.
export function hashLocations(source, map) {
  const consumer = new SourceMapConsumer(map)
  const offsets = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') offsets.push(i + 1)
  const sources = new Map()
  for (const name of consumer.sources) {
    if (
      !/(?:^|\/)node_modules\/@noble\/hashes\/(?:(?:esm|src)\/)?(?:_md|sha2|sha256)\.[jt]s$/.test(
        name
      )
    )
      continue
    const text = consumer.sourceContentFor(name)
    if (!text) throw new Error('Hash source content unavailable')
    const file = ts.createSourceFile(
      name,
      text,
      ts.ScriptTarget.Latest,
      true,
      name.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
    )
    const scopes = [],
      constructors = []
    function visit(node) {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        if (node.name)
          scopes.push({ start: node.getStart(file), end: node.end, name: node.name.text })
        if (/\/_md\.[jt]s$/.test(name)) {
          const ctor = node.members.find(ts.isConstructorDeclaration)
          const statements = ctor?.body?.statements ?? []
          const afterSuper =
            statements.findIndex(
              (statement) =>
                ts.isExpressionStatement(statement) &&
                ts.isCallExpression(statement.expression) &&
                statement.expression.expression.kind === ts.SyntaxKind.SuperKeyword
            ) + 1
          if (afterSuper > 0 && statements[afterSuper]) constructors.push(statements[afterSuper])
        }
      }
      if (ts.isFunctionLike(node) && node.body) {
        const label = ts.isConstructorDeclaration(node)
          ? node.parent.name?.text
          : node.name?.getText(file)
        if (label) scopes.push({ start: node.getStart(file), end: node.end, name: label })
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    sources.set(name, { file, scopes, constructors })
  }
  return {
    tracepoints() {
      const points = []
      for (const [name, { file, constructors }] of sources) {
        for (const statement of constructors) {
          const original = file.getLineAndCharacterOfPosition(statement.getStart(file))
          const generated = consumer.generatedPositionFor({
            source: name,
            line: original.line + 1,
            column: original.character,
            bias: SourceMapConsumer.LEAST_UPPER_BOUND,
          })
          if (generated.line == null || generated.column == null)
            throw new Error('Mapped hash constructor unavailable')
          const back = consumer.originalPositionFor(generated)
          if (back.source !== name || back.line !== original.line + 1)
            throw new Error('Mapped hash constructor is outside its statement')
          points.push({ lineNumber: generated.line - 1, columnNumber: generated.column })
        }
      }
      if (!points.length) throw new Error('Mapped hash constructors unavailable')
      return points
    },
    functionName(fn) {
      const offset = fn.ranges[0]?.startOffset
      if (!Number.isInteger(offset) || offset < 0 || offset >= source.length) return fn.functionName
      let low = 0,
        high = offsets.length
      while (low + 1 < high) {
        const middle = (low + high) >>> 1
        if (offsets[middle] <= offset) low = middle
        else high = middle
      }
      const original = consumer.originalPositionFor({
        line: low + 1,
        column: offset - offsets[low],
      })
      const own = sources.get(original.source)
      if (!own || original.line == null) return fn.functionName
      const position = own.file.getPositionOfLineAndCharacter(original.line - 1, original.column)
      const scope = own.scopes
        .filter((row) => row.start <= position && row.end > position)
        .sort((a, b) => a.end - a.start - (b.end - b.start))[0]
      return scope?.name ?? fn.functionName
    },
  }
}
