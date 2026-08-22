#!/usr/bin/env node
/**
 * Generates a large, realistic Ābele vault for performance and end-to-end testing.
 *
 * Output is fully deterministic for a given --seed, so a performance run can be repeated
 * and compared. Everything the plugin reads is modelled: the `groups` relation graph,
 * journals, tasks, finance accounts/transactions/categories, time entries and AI chats.
 *
 * Usage:
 *   node scripts/generate-vault.mjs --out ~/obsidian-scale-test
 *   node scripts/generate-vault.mjs --out ~/obsidian-scale-test --files 20000 --seed 7 --force
 *
 * The group graph is shaped deliberately: a few ordinary groups plus one deliberately huge
 * "mega group" whose transitive closure covers a large share of the vault. Group scope
 * resolution costs (nodes in the closure) x (notes carrying a `groups` property), so a wide
 * closure over a link-dense vault is what makes that cost observable.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ── argument parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { files: 12000, seed: 42, force: false, out: null }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--force') args.force = true
    else if (arg === '--out') args.out = argv[++i]
    else if (arg === '--files') args.files = Number(argv[++i])
    else if (arg === '--seed') args.seed = Number(argv[++i])
    else if (arg === '--help' || arg === '-h') args.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

const USAGE = `
Generate a large Ābele test vault.

  --out <dir>     Target vault directory (required)
  --files <n>     Approximate total markdown file count (default 12000)
  --seed <n>      PRNG seed for reproducible output (default 42)
  --force         Allow writing into a directory that already has content
  -h, --help      Show this message
`

// ── deterministic PRNG ──────────────────────────────────────────────────────────

/** mulberry32 — small, fast, and stable across Node versions. */
function makeRandom(seed) {
  let state = seed >>> 0
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── vocabulary ──────────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Anna', 'John', 'Maria', 'Peter', 'Elena', 'David', 'Sofia', 'Marcus', 'Nina', 'Oliver',
  'Клара', 'Артём', 'Дарья', 'Игорь', 'Полина', 'Тимур', 'Вера', 'Родион',
]
const LAST_NAMES = [
  'Perkins', 'Swanson', 'Knope', 'Ludgate', 'Haverford', 'Dwyer', 'Traeger', 'Wyatt',
  'Соколов', 'Морозова', 'Лебедев', 'Кузнецова',
]
const PLACE_NAMES = [
  'Pawnee', 'Riverside Park', 'Coffee House', 'City Library', 'Old Harbour', 'North Bridge',
  'Ветряная гора', 'Старый маяк', 'Тихая бухта',
]
const PROJECT_WORDS = [
  'Atlas', 'Beacon', 'Compass', 'Delta', 'Ember', 'Foundry', 'Granite', 'Harbor',
  'Ionic', 'Juniper', 'Keystone', 'Lattice', 'Meridian', 'Nimbus', 'Orchard', 'Prism',
]
const TOPIC_WORDS = [
  'Architecture', 'Retrospective', 'Research', 'Notes', 'Planning', 'Review', 'Draft',
  'Summary', 'Interview', 'Analysis', 'Roadmap', 'Postmortem', 'Spec', 'Proposal',
]
const SENTENCES = [
  'Обсудили план на следующий квартал и зафиксировали риски.',
  'The estimate turned out optimistic once we looked at the integration surface.',
  'Записал основные мысли после встречи, нужно вернуться к этому позже.',
  'Followed up on the open questions from last week and closed two of them.',
  'Черновик готов, осталось вычитать и согласовать формулировки.',
  'Measured the cold start again — the numbers moved less than expected.',
  'Договорились перенести обсуждение бюджета на понедельник.',
  'Collected feedback from three people; the themes overlap almost entirely.',
]
const CURRENCIES = ['EUR', 'USD', 'GBP']
const EXPENSE_CATEGORIES = [
  'Groceries', 'Rent', 'Transport', 'Utilities', 'Dining', 'Books', 'Health',
  'Software', 'Travel', 'Gifts', 'Education', 'Hardware',
]
const REVENUE_CATEGORIES = ['Salary', 'Consulting', 'Dividends', 'Refunds']
const RECURRENCES = [
  'every day', 'every week on Monday', 'every 2 weeks on Friday', 'every month on 1',
  'every last Friday', 'every first day of month', 'every year',
]

// ── file collection ─────────────────────────────────────────────────────────────

/**
 * Files are buffered and written at the end so that link targets can be referenced before
 * they exist, and so a failure part-way through does not leave a half-populated vault.
 */
class VaultWriter {
  constructor(root) {
    this.root = root
    this.files = new Map()
  }

  add(relPath, content) {
    if (this.files.has(relPath)) {
      throw new Error(`Duplicate path generated: ${relPath}`)
    }
    this.files.set(relPath, content)
  }

  has(relPath) {
    return this.files.has(relPath)
  }

  get size() {
    return this.files.size
  }

  flush() {
    const dirs = new Set()
    for (const relPath of this.files.keys()) {
      dirs.add(path.dirname(path.join(this.root, relPath)))
    }
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true })
    }
    for (const [relPath, content] of this.files) {
      fs.writeFileSync(path.join(this.root, relPath), content, 'utf8')
    }
  }
}

// ── frontmatter helpers ─────────────────────────────────────────────────────────

/**
 * Wikilinks must be emitted as quoted YAML scalars. Unquoted `- [[X]]` parses as a nested
 * array, and every reader in the plugin checks `typeof value === 'string'` before matching
 * the wikilink pattern — so an unquoted link is silently invisible to group resolution.
 */
function yamlValue(value) {
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const str = String(value)
  if (str.includes('[[') || /[:#'"]/.test(str) || str === '') {
    return `'${str.replace(/'/g, "''")}'`
  }
  return str
}

function frontmatter(props) {
  const lines = ['---']
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      lines.push(`${key}:`)
      for (const item of value) lines.push(`  - ${yamlValue(item)}`)
    } else {
      lines.push(`${key}: ${yamlValue(value)}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

function note(props, body) {
  return `${frontmatter(props)}\n${body}\n`
}

/** Obsidian-safe file name: strips characters the plugin's own cleanFileName removes. */
function safeName(name) {
  return name
    .replace(/[[\]/\\?%*:|"<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function pad(n, width = 2) {
  return String(n).padStart(width, '0')
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// ── generation ──────────────────────────────────────────────────────────────────

function generate({ out, files: targetFiles, seed }) {
  const random = makeRandom(seed)
  const pick = (arr) => arr[Math.floor(random() * arr.length)]
  const int = (min, max) => min + Math.floor(random() * (max - min + 1))
  const chance = (p) => random() < p

  const writer = new VaultWriter(out)

  // Budget split across note kinds. Ratios are tuned so the vault looks like a vault that
  // has been lived in rather than one dominated by a single note type.
  const budget = {
    notes: Math.round(targetFiles * 0.5),
    journals: Math.round(targetFiles * 0.1),
    tasks: Math.round(targetFiles * 0.12),
    transactions: Math.round(targetFiles * 0.16),
    timeEntries: Math.round(targetFiles * 0.08),
    chats: Math.max(20, Math.round(targetFiles * 0.003)),
  }

  const stats = {}

  // ── 1. group hierarchy ────────────────────────────────────────────────────────
  // A group note is an ordinary note; it becomes a group purely by being referenced from
  // another note's `groups` property. Depth-3 tree, plus one intentionally huge branch.

  const ROOT_GROUPS = [
    { name: 'Projects', mega: true },
    { name: 'People', mega: false },
    { name: 'Places', mega: false },
    { name: 'Books', mega: false },
    { name: 'Learning', mega: false },
    { name: 'Household', mega: false },
  ]

  /** @type {{path: string, name: string, parent: string|null, root: string, depth: number}[]} */
  const groups = []
  const groupsByRoot = new Map()

  for (const root of ROOT_GROUPS) {
    const rootPath = `Notes/${root.name}.md`
    const rootGroup = { path: rootPath, name: root.name, parent: null, root: root.name, depth: 0 }
    groups.push(rootGroup)
    groupsByRoot.set(root.name, [rootGroup])

    // The mega branch gets many more subgroups, widening its transitive closure.
    const subCount = root.mega ? 24 : 6
    for (let i = 0; i < subCount; i++) {
      const subName = safeName(`${pick(PROJECT_WORDS)} ${root.name} ${i + 1}`)
      const subPath = `Notes/${subName}.md`
      if (writer.has(subPath)) continue
      const sub = { path: subPath, name: subName, parent: rootGroup.name, root: root.name, depth: 1 }
      groups.push(sub)
      groupsByRoot.get(root.name).push(sub)

      const leafCount = root.mega ? 6 : 2
      for (let j = 0; j < leafCount; j++) {
        const leafName = safeName(`${subName} ${pick(TOPIC_WORDS)} ${j + 1}`)
        const leafPath = `Notes/${leafName}.md`
        const leaf = { path: leafPath, name: leafName, parent: subName, root: root.name, depth: 2 }
        groups.push(leaf)
        groupsByRoot.get(root.name).push(leaf)
      }
    }
  }

  for (const group of groups) {
    if (writer.has(group.path)) continue
    writer.add(
      group.path,
      note(
        {
          created: '2024-01-15',
          groups: group.parent ? [`[[${group.parent}]]`] : undefined,
        },
        `${group.name}\n\n${pick(SENTENCES)}\n`
      )
    )
  }
  stats.groupNotes = groups.length

  const megaGroups = groupsByRoot.get('Projects')
  const megaRoot = megaGroups[0]

  // ── 2. people, places and regular notes ───────────────────────────────────────

  const peopleGroups = groupsByRoot.get('People')
  const placeGroups = groupsByRoot.get('Places')

  const people = []
  for (let i = 0; i < 120; i++) {
    const name = safeName(`${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`)
    const relPath = `Notes/${name}.md`
    if (writer.has(relPath)) continue
    people.push({ path: relPath, name })
    writer.add(
      relPath,
      note(
        {
          type: 'person',
          created: '2024-02-01',
          groups: [`[[${pick(peopleGroups).name}]]`],
        },
        `${name}\n\n${pick(SENTENCES)}\n`
      )
    )
  }

  const places = []
  for (const placeName of PLACE_NAMES) {
    const name = safeName(placeName)
    const relPath = `Notes/${name}.md`
    if (writer.has(relPath)) continue
    places.push({ path: relPath, name })
    writer.add(
      relPath,
      note({ type: 'place', created: '2024-02-01', groups: [`[[${pick(placeGroups).name}]]`] },
        `${name}\n\n${pick(SENTENCES)}\n`)
    )
  }

  // The link pool grows as notes are generated, so journals, tasks and transactions link
  // into the full population of group-attached notes rather than a handful of people. That
  // density is the point: backlink lookups and relation walks scale with how many notes
  // point at a group's members, and a sparsely linked vault hides that cost entirely.
  const linkPool = [...people.map((p) => p.name), ...places.map((p) => p.name)]
  const bodyLinks = (count) => {
    const chosen = new Set()
    for (let attempt = 0; attempt < count * 4 && chosen.size < count; attempt++) {
      chosen.add(pick(linkPool))
    }
    return [...chosen].map((name) => `[[${name}]]`).join(' ')
  }

  // Regular notes. Most attach to the mega branch, which is what gives that group a
  // closure large enough for its resolution cost to dominate.
  const regularNotes = []
  let noteIndex = 0
  while (regularNotes.length < budget.notes) {
    const title = safeName(
      `${pick(PROJECT_WORDS)} ${pick(TOPIC_WORDS)} ${++noteIndex}`
    )
    const relPath = `Notes/${title}.md`
    if (writer.has(relPath)) continue

    const useMega = chance(0.65)
    const pool = useMega ? megaGroups : groups
    const parents = [pick(pool).name]
    if (chance(0.18)) parents.push(pick(groups).name)

    const paragraphs = []
    for (let i = 0; i < int(2, 5); i++) {
      paragraphs.push(`${pick(SENTENCES)} ${bodyLinks(int(1, 3))}`)
    }

    writer.add(
      relPath,
      note(
        {
          created: `2024-${pad(int(1, 12))}-${pad(int(1, 28))}`,
          groups: [...new Set(parents)].map((g) => `[[${g}]]`),
          tags: chance(0.3) ? ['reference'] : undefined,
        },
        `${title}\n\n${paragraphs.join('\n\n')}\n`
      )
    )
    regularNotes.push({ path: relPath, name: title })
    // Available as a link target from here on, so the graph thickens as generation proceeds.
    linkPool.push(title)
  }
  stats.notes = regularNotes.length

  // ── 3. journals ───────────────────────────────────────────────────────────────
  // The date must appear in the FILENAME — the plugin extracts journal dates from the
  // file name, not from frontmatter.

  let journalCount = 0
  const journalStart = new Date(2024, 0, 1)
  for (let day = 0; journalCount < budget.journals; day++) {
    const date = new Date(journalStart.getTime() + day * 86400000)
    const iso = formatDate(date)
    const relPath = `Journals/${date.getFullYear()}/${iso}.md`
    if (writer.has(relPath)) continue

    // A day's entry mentions several notes, which is what makes journals show up as logs
    // across many different group branches.
    const paragraphs = []
    for (let i = 0; i < int(3, 8); i++) {
      paragraphs.push(`${pick(SENTENCES)} ${bodyLinks(int(1, 3))}`)
    }

    writer.add(relPath, note({ type: 'journal', created: iso }, paragraphs.join('\n\n') + '\n'))
    journalCount++
  }
  stats.journals = journalCount

  // ── 4. finance ────────────────────────────────────────────────────────────────

  const financeGroup = groupsByRoot.get('Household')[0]

  const assetAccounts = []
  for (const bank of ['Swedbank', 'Revolut', 'Wise', 'Cash', 'Savings', 'Brokerage']) {
    for (const currency of CURRENCIES) {
      const name = `${bank} ${currency}`
      const relPath = `Finance/Accounts/${name}.md`
      if (writer.has(relPath)) continue
      assetAccounts.push({ path: relPath, name, currency })
      writer.add(
        relPath,
        note(
          {
            type: 'account',
            accountType: 'asset',
            currency,
            startingBalance: int(100, 8000),
            startingBalanceDate: '2024-01-01',
            groups: [`[[${financeGroup.name}]]`],
          },
          `${name}\n`
        )
      )
    }
  }

  const liabilityAccounts = []
  for (let i = 0; i < 8; i++) {
    const person = pick(people)
    const name = safeName(`Loan to ${person.name} ${i + 1}`)
    const relPath = `Finance/Accounts/${name}.md`
    if (writer.has(relPath)) continue
    liabilityAccounts.push({ path: relPath, name, currency: 'EUR' })
    writer.add(
      relPath,
      note(
        {
          type: 'account',
          accountType: 'liability',
          currency: 'EUR',
          startingBalance: 0,
          startingBalanceDate: '2024-01-01',
        },
        `${name}\n\nLent to [[${person.name}]].\n`
      )
    )
  }

  const expenseAccounts = []
  for (const category of EXPENSE_CATEGORIES) {
    const relPath = `Finance/Accounts/${category}.md`
    if (writer.has(relPath)) continue
    expenseAccounts.push({ path: relPath, name: category })
    writer.add(relPath, note({ type: 'account', accountType: 'expense' }, `${category}\n`))
  }

  const revenueAccounts = []
  for (const source of REVENUE_CATEGORIES) {
    const relPath = `Finance/Accounts/${source}.md`
    if (writer.has(relPath)) continue
    revenueAccounts.push({ path: relPath, name: source })
    writer.add(relPath, note({ type: 'account', accountType: 'revenue' }, `${source}\n`))
  }

  // Computed accounts aggregate balances from linked accounts and are excluded from the
  // total so they do not double-count against the assets they sum.
  for (const currency of CURRENCIES) {
    const sources = assetAccounts.filter((a) => a.currency === currency)
    if (sources.length === 0) continue
    const name = `All ${currency} cash`
    const relPath = `Finance/Accounts/${name}.md`
    writer.add(
      relPath,
      note(
        {
          type: 'account',
          accountType: 'computed',
          currency,
          accounts: sources.map((a) => `[[${a.name}]]`),
          excludeFromTotal: true,
        },
        `${name}\n`
      )
    )
  }

  const categoryNotes = []
  for (const category of [...EXPENSE_CATEGORIES, ...REVENUE_CATEGORIES]) {
    const relPath = `Finance/Categories/${category}.md`
    if (writer.has(relPath)) continue
    categoryNotes.push({ name: category })
    writer.add(relPath, note({ type: 'finance-category' }, `${category}\n`))
  }
  stats.accounts = assetAccounts.length + liabilityAccounts.length +
    expenseAccounts.length + revenueAccounts.length + CURRENCIES.length
  stats.categories = categoryNotes.length

  let transactionCount = 0
  let transactionSeq = 0
  while (transactionCount < budget.transactions) {
    transactionSeq++
    const date = new Date(journalStart.getTime() + int(0, 900) * 86400000)
    const iso = formatDate(date)
    const roll = random()

    let from
    let to
    let title
    if (roll < 0.62) {
      from = pick(assetAccounts)
      to = pick(expenseAccounts)
      title = `${to.name} ${transactionSeq}`
    } else if (roll < 0.82) {
      from = pick(revenueAccounts)
      to = pick(assetAccounts)
      title = `${from.name} ${transactionSeq}`
    } else if (roll < 0.92) {
      from = pick(assetAccounts)
      to = pick(assetAccounts)
      if (from.name === to.name) continue
      title = `Transfer ${transactionSeq}`
    } else {
      // Lending and repayment against a liability account.
      const liability = pick(liabilityAccounts)
      const cash = pick(assetAccounts)
      const lending = chance(0.5)
      from = lending ? cash : liability
      to = lending ? liability : cash
      title = `${lending ? 'Lent' : 'Returned'} ${transactionSeq}`
    }

    const relPath = `Finance/Transactions/${date.getFullYear()}/${pad(date.getMonth() + 1)}/${safeName(title)}.md`
    if (writer.has(relPath)) continue

    const currency = from.currency || to.currency || 'EUR'
    const props = {
      type: 'transaction',
      date: iso,
      from: `[[${from.name}]]`,
      to: `[[${to.name}]]`,
      amount: Number((random() * 400 + 5).toFixed(2)),
      currency,
    }
    if (chance(0.35)) props.category = `[[${pick(categoryNotes).name}]]`
    if (chance(0.2)) props.groups = [`[[${pick(groups).name}]]`]
    // A cross-currency transfer records the counterpart amount on the receiving side.
    if (to.currency && from.currency && to.currency !== from.currency) {
      props.foreignCurrency = to.currency
      props.foreignAmount = Number((props.amount * (0.85 + random() * 0.35)).toFixed(2))
    }

    // Real transactions describe what the money was for, naming the notes involved.
    writer.add(
      relPath,
      note(props, `${title}\n\n${pick(SENTENCES)} ${bodyLinks(int(1, 3))}\n`)
    )
    transactionCount++
  }
  stats.transactions = transactionCount

  // ── 5. tasks ──────────────────────────────────────────────────────────────────
  // The task title is the first body line; frontmatter carries no title.

  let taskCount = 0
  let taskSeq = 0
  while (taskCount < budget.tasks) {
    taskSeq++
    const title = safeName(`${pick(TOPIC_WORDS)} for ${pick(PROJECT_WORDS)} ${taskSeq}`)
    const relPath = `Tasks/${title}.md`
    if (writer.has(relPath)) continue

    const created = new Date(journalStart.getTime() + int(0, 900) * 86400000)
    const due = new Date(created.getTime() + int(1, 60) * 86400000)
    const done = chance(0.45)

    const props = {
      type: 'task',
      created: formatDate(created),
      due: formatDate(due),
      groups: [`[[${pick(chance(0.7) ? megaGroups : groups).name}]]`],
    }
    if (chance(0.4)) props.dueTime = `${pad(int(8, 20))}:${pick(['00', '15', '30', '45'])}`
    if (chance(0.25)) props.date = formatDate(created)
    if (chance(0.15)) props.recurrence = pick(RECURRENCES)
    if (done) props.completed = formatDate(due)

    writer.add(
      relPath,
      note(
        props,
        `${title} with ${bodyLinks(int(1, 2))}\n\n${pick(SENTENCES)} ${bodyLinks(int(1, 2))}\n`
      )
    )
    taskCount++
  }
  stats.tasks = taskCount

  // ── 6. time entries ───────────────────────────────────────────────────────────

  let timeCount = 0
  let timeSeq = 0
  while (timeCount < budget.timeEntries) {
    timeSeq++
    const date = new Date(journalStart.getTime() + int(0, 900) * 86400000)
    const startHour = int(8, 18)
    const startMinute = pick([0, 15, 30, 45])
    const durationMinutes = int(15, 220)
    const startAt = new Date(date)
    startAt.setHours(startHour, startMinute, 0, 0)
    const endAt = new Date(startAt.getTime() + durationMinutes * 60000)

    const tracked = pick(regularNotes.length ? regularNotes : groups)
    const relPath =
      `Time/${date.getFullYear()}/${pad(date.getMonth() + 1)}/` +
      `${safeName(tracked.name)} ${pad(startHour)}-${pad(startMinute)} ${timeSeq}.md`
    if (writer.has(relPath)) continue

    const fmt = (d) =>
      `${formatDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

    writer.add(
      relPath,
      note(
        {
          type: 'time-entry',
          start: fmt(startAt),
          end: fmt(endAt),
          groups: [`[[${tracked.name}]]`],
        },
        ''
      )
    )
    timeCount++
  }
  stats.timeEntries = timeCount

  // ── 7. AI chats, skills and prompts ───────────────────────────────────────────

  const TOOL_NAMES = ['read', 'edit', 'find', 'ls', 'write']
  let chatCount = 0
  for (let i = 0; i < budget.chats; i++) {
    const date = new Date(journalStart.getTime() + int(200, 900) * 86400000)
    const iso = formatDate(date)
    const title = safeName(`${pick(TOPIC_WORDS)} ${pick(PROJECT_WORDS)} ${i + 1}`)
    const relPath = `System/AI/Chats/${date.getFullYear()}-${pad(date.getMonth() + 1)}/${iso} ${title}.abchat`
    if (writer.has(relPath)) continue

    const baseTs = date.getTime()
    const messages = []
    const internalMessages = []

    const userId = `m${i}_user`
    messages.push({
      id: userId,
      role: 'user',
      content: `Разберись с ${title}`,
      timestamp: baseTs,
    })
    internalMessages.push({
      role: 'user',
      content: `Разберись с ${title}`,
      timestamp: baseTs,
      chatMessageId: userId,
    })

    const toolName = pick(TOOL_NAMES)
    const toolId = `m${i}_tool`
    const callId = `call_${i}`
    const target = pick(regularNotes).path
    messages.push({
      id: toolId,
      parentId: userId,
      role: 'tool-call',
      content: `Calling ${toolName}`,
      toolCallId: callId,
      toolName,
      toolParams: { path: target },
      toolStatus: 'approved',
      toolResult: `Read ${target}`,
      timestamp: baseTs + 1000,
    })
    internalMessages.push({
      role: 'assistant',
      content: [{ type: 'toolCall', id: callId, name: toolName, arguments: { path: target } }],
      model: 'claude-sonnet-4',
      usage: { input: 1200, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 1240 },
      stopReason: 'toolUse',
      timestamp: baseTs + 500,
      chatMessageId: userId,
    })
    internalMessages.push({
      role: 'toolResult',
      toolCallId: callId,
      toolName,
      content: [{ type: 'text', text: `Read ${target}` }],
      isError: false,
      timestamp: baseTs + 1000,
      chatMessageId: toolId,
    })

    const assistantId = `m${i}_assistant`
    messages.push({
      id: assistantId,
      parentId: toolId,
      role: 'assistant',
      content: pick(SENTENCES),
      usage: { input: 1400, output: 340, total: 1740, speed: 42 },
      timestamp: baseTs + 3000,
    })
    internalMessages.push({
      role: 'assistant',
      content: [{ type: 'text', text: pick(SENTENCES) }],
      model: 'claude-sonnet-4',
      usage: { input: 1400, output: 340, cacheRead: 900, cacheWrite: 0, totalTokens: 1740 },
      stopReason: 'stop',
      timestamp: baseTs + 3000,
      chatMessageId: assistantId,
    })

    const chat = {
      metadata: {
        type: 'abele-chat',
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4',
        created: iso,
        title,
        permissionMode: 'allow-edit',
        toolModes: { read: 'auto', edit: 'ask', find: 'auto' },
        scopeEntries: [
          { type: 'group', path: pick(megaGroups).path },
          { type: 'folder', path: 'Notes' },
        ],
        activeLeafId: assistantId,
      },
      messages,
      internalMessages,
    }

    writer.add(relPath, JSON.stringify(chat, null, 2) + '\n')
    chatCount++
  }
  stats.chats = chatCount

  for (const skill of [
    { name: 'review', description: 'Code review with a best-practices checklist' },
    { name: 'summarize', description: 'Summarise a long note into key points' },
    { name: 'plan', description: 'Turn a rough idea into an actionable plan' },
  ]) {
    writer.add(
      `System/AI/Skills/${skill.name}.md`,
      note(
        { type: 'abele-skill', name: skill.name, description: skill.description },
        `When asked to ${skill.name}, follow these steps:\n\n1. Read the relevant notes.\n2. ${pick(SENTENCES)}\n`
      )
    )
  }

  for (const prompt of ['Daily review', 'Weekly finance check', 'Research digest']) {
    writer.add(
      `System/AI/Prompts/${safeName(prompt)}.md`,
      note({ type: 'abele-prompt', description: prompt }, `${pick(SENTENCES)}\n`)
    )
  }

  // ── 8. minimal Obsidian configuration ─────────────────────────────────────────

  const obsidianDir = path.join(out, '.obsidian')
  fs.mkdirSync(obsidianDir, { recursive: true })
  fs.writeFileSync(
    path.join(obsidianDir, 'app.json'),
    JSON.stringify({ alwaysUpdateLinks: true, showUnsupportedFiles: true }, null, 2),
    'utf8'
  )
  fs.writeFileSync(
    path.join(obsidianDir, 'core-plugins.json'),
    JSON.stringify(['file-explorer', 'global-search', 'switcher', 'graph', 'backlink'], null, 2),
    'utf8'
  )

  writer.flush()

  stats.total = writer.size
  stats.megaGroupRoot = megaRoot.path
  stats.megaGroupNodes = megaGroups.length
  return stats
}

// ── entry point ─────────────────────────────────────────────────────────────────

function main() {
  let args
  try {
    args = parseArgs(process.argv)
  } catch (error) {
    console.error(String(error.message))
    console.error(USAGE)
    process.exit(1)
  }

  if (args.help || !args.out) {
    console.log(USAGE)
    process.exit(args.help ? 0 : 1)
  }

  const out = path.resolve(args.out.replace(/^~(?=$|\/)/, os.homedir()))

  if (fs.existsSync(out)) {
    const existing = fs.readdirSync(out)
    if (existing.length > 0 && !args.force) {
      console.error(`Refusing to write into non-empty directory: ${out}`)
      console.error('Pass --force if you intend to add to it.')
      process.exit(1)
    }
  }

  const startedAt = Date.now()
  console.log(`Generating vault at ${out} (target ${args.files} files, seed ${args.seed})…`)
  const stats = generate({ out, files: args.files, seed: args.seed })
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)

  console.log(`
Done in ${seconds}s — ${stats.total} files

  group notes    ${stats.groupNotes}
  notes          ${stats.notes}
  journals       ${stats.journals}
  tasks          ${stats.tasks}
  transactions   ${stats.transactions}
  time entries   ${stats.timeEntries}
  accounts       ${stats.accounts}
  categories     ${stats.categories}
  AI chats       ${stats.chats}

  mega group     ${stats.megaGroupRoot} (${stats.megaGroupNodes} group nodes in its branch)
`)
}

main()
