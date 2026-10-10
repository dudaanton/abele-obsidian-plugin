import ts from 'typescript'
import { parse, compileScript, registerTS } from '@vue/compiler-sfc'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
registerTS(() => ts)

/** Imports in emitted JS, not type-only edges. Dynamic imports do not constrain load order. */
export function runtimeImports(source, filename) {
  if (filename.endsWith('.vue')) {
    const { descriptor } = parse(source, { filename })
    if (!descriptor.script && !descriptor.scriptSetup) return []
    source = compileScript(descriptor, {
      id: filename,
      fs: { fileExists: existsSync, readFile: (file) => readFileSync(file, 'utf8') },
    }).content
  }
  const emitted = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    fileName: filename.replace(/\.vue$/, '.ts'),
  }).outputText
  const ast = ts.createSourceFile(filename, emitted, ts.ScriptTarget.Latest, true)
  const imports = []
  for (const node of ast.statements) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text)
  }
  return imports
}

export function importGraph(root = join(plugin, 'src')) {
  const sources = new Map()
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.(ts|vue)$/.test(file) && !file.endsWith('.d.ts'))
        sources.set(file, readFileSync(file, 'utf8'))
    }
  }
  walk(root)
  const graph = new Map()
  for (const [file, source] of sources) {
    const edges = []
    for (const specifier of runtimeImports(source, file)) {
      const clean = specifier.split('?')[0]
      const base = clean.startsWith('@/')
        ? join(root, clean.slice(2))
        : clean.startsWith('.')
          ? resolve(dirname(file), clean)
          : null
      if (!base) continue
      const target = [base, `${base}.ts`, `${base}.vue`, join(base, 'index.ts')].find((candidate) =>
        sources.has(candidate)
      )
      if (target) edges.push(relative(root, target))
    }
    graph.set(relative(root, file), [...new Set(edges)].sort())
  }
  return graph
}

/** Strongly connected components: each member can synchronously import every other member. */
export function cyclicComponents(graph) {
  let next = 0
  const indices = new Map(),
    low = new Map(),
    stack = [],
    active = new Set(),
    cycles = []
  function visit(node) {
    indices.set(node, next)
    low.set(node, next++)
    stack.push(node)
    active.add(node)
    for (const edge of graph.get(node) ?? []) {
      if (!indices.has(edge)) {
        visit(edge)
        low.set(node, Math.min(low.get(node), low.get(edge)))
      } else if (active.has(edge)) low.set(node, Math.min(low.get(node), indices.get(edge)))
    }
    if (low.get(node) !== indices.get(node)) return
    const component = []
    let member
    do {
      member = stack.pop()
      active.delete(member)
      component.push(member)
    } while (member !== node)
    if (component.length > 1 || graph.get(node)?.includes(node)) cycles.push(component.sort())
  }
  for (const node of [...graph.keys()].sort()) if (!indices.has(node)) visit(node)
  return cycles.sort((a, b) => a[0].localeCompare(b[0]))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const graph = importGraph()
  const cycles = cyclicComponents(graph)
  console.log(
    `${cycles.length} runtime import components (${[...graph].length} modules; type-only and dynamic imports excluded)`
  )
  for (const component of cycles) {
    console.log(`\n${component.length} modules:`)
    for (const member of component)
      console.log(
        `  ${member} -> ${(graph.get(member) ?? []).filter((edge) => component.includes(edge)).join(', ')}`
      )
  }
}
