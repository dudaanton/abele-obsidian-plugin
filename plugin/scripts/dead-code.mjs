/** Advisory inventory, not permission to delete: dynamic/public APIs require manual review. */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

function specifiers(text, file) {
  const script = file.endsWith('.vue')
    ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
    : text
  const source = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true)
  const found = []
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      found.push(node.moduleSpecifier.text)
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(source) === 'require') &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      found.push(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Keys are plugin-relative paths. Roots include tests and any manually registered public API. */
export function unreferencedModules(files, roots) {
  const seen = new Set()
  const walk = (file) => {
    if (seen.has(file) || !(file in files)) return
    seen.add(file)
    for (const specifier of specifiers(files[file], file)) {
      const path = specifier.startsWith('@/')
        ? `src/${specifier.slice(2)}`
        : specifier.startsWith('.')
          ? posix.normalize(posix.join(posix.dirname(file), specifier))
          : null
      if (!path) continue
      const target = [
        path,
        ...['.ts', '.js', '.vue', '/index.ts', '/index.js'].map((suffix) => path + suffix),
      ].find((candidate) => candidate in files)
      if (target) walk(target)
    }
  }
  roots.forEach(walk)
  return Object.keys(files)
    .filter((file) => file.startsWith('src/') && !file.endsWith('.d.ts') && !seen.has(file))
    .sort()
}

function collect(root, directory, files) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = posix.join(directory, entry.name)
    if (entry.isDirectory()) collect(root, path, files)
    else if (['.ts', '.js', '.vue'].includes(extname(path)))
      files[path] = readFileSync(join(root, path), 'utf8')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const files = {}
  collect(root, 'src', files)
  collect(root, 'tests', files)
  const roots = ['src/main.ts', ...Object.keys(files).filter((file) => file.startsWith('tests/'))]
  const unused = unreferencedModules(files, roots)
  console.log(
    'Advisory unreferenced-module inventory (review dynamic registration before deletion):'
  )
  for (const file of unused) console.log(file)
  console.log(
    `${unused.length} candidates; test-only exports and module members are not deletion candidates.`
  )
}
