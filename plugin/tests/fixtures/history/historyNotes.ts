/**
 * A small history for the timeline's e2e tier: rulers, thinkers, scientists, artists, events and
 * eras, written the way people write them — `born`/`died` for people, `start`/`end` for wars,
 * `date` for a battle, `period` for a reign, `-490` and `490 до н.э.` before Christ, `ок. 1450`,
 * `1450?`, `1440–1455`, `XVI век`. The dates are the textbook ones; the pictures are drawn here,
 * a coloured circle with initials, so nothing is fetched and nothing belongs to anyone.
 */

export interface HistoryNote {
  name: string
  category: string
  fm: Record<string, string | number>
}

const person = (
  name: string,
  category: string,
  born: string | number,
  died?: string | number,
  cover?: string
): HistoryNote => ({
  name,
  category,
  fm: {
    born,
    ...(died !== undefined ? { died } : {}),
    ...(cover ? { cover: `[[${cover}]]` } : {}),
  },
})

export const HISTORY_NOTES: HistoryNote[] = [
  person('Сократ', 'Мыслители', -470, -399, 'socrates.svg'),
  person('Платон', 'Мыслители', '428 до н.э.', '348 до н.э.'),
  person('Аристотель', 'Мыслители', '384 BC', '322 BC'),
  person('Конфуций', 'Мыслители', -551, -479),
  person('Августин', 'Мыслители', 354, 430),
  person('Фома Аквинский', 'Мыслители', 1225, 1274),
  person('Эразм', 'Мыслители', 'ок. 1466', 1536),
  person('Макиавелли', 'Мыслители', '1469-05-03', '1527-06-21'),
  person('Монтень', 'Мыслители', 1533, 1592),
  person('Фрэнсис Бэкон', 'Мыслители', 1561, 1626),
  person('Декарт', 'Мыслители', '31 марта 1596', '11 февраля 1650'),
  person('Кант', 'Мыслители', 1724, 1804),
  person('Александр Македонский', 'Правители', -356, -323, 'alexander.svg'),
  person('Юлий Цезарь', 'Правители', '100 до н.э.', '44 до н.э.'),
  person('Октавиан Август', 'Правители', '63 BC', '14'),
  person('Карл Великий', 'Правители', '742?', 814),
  person('Чингисхан', 'Правители', '1155–1167', 1227),
  person('Иван Грозный', 'Правители', 1530, 1584, 'ivan.svg'),
  person('Елизавета I', 'Правители', 1533, 1603),
  person('Пётр I', 'Правители', 1672, 1725),
  person('Наполеон', 'Правители', '1769-08-15', '1821-05-05'),
  { name: 'Правление Ивана III', category: 'Правители', fm: { period: '1462–1505' } },
  person('Архимед', 'Учёные', 'ок. 287 до н.э.', '212 до н.э.'),
  person('Птолемей', 'Учёные', 'ок. 100', 'ок. 170'),
  person('Ибн Сина', 'Учёные', 980, 1037),
  person('Коперник', 'Учёные', 1473, 1543),
  person('Галилей', 'Учёные', 1564, 1642, 'galileo.svg'),
  person('Кеплер', 'Учёные', 1571, 1630),
  person('Ньютон', 'Учёные', 1643, 1727),
  person('Эйнштейн', 'Учёные', 1879, 1955),
  person('Гомер', 'Искусство', 'VIII век до н.э.'),
  person('Данте', 'Искусство', 1265, 1321),
  person('Босх', 'Искусство', '1450?', 1516),
  person('Леонардо', 'Искусство', '15 апреля 1452', '2 мая 1519'),
  person('Микеланджело', 'Искусство', '1475-03-06', '1564-02-18'),
  person('Шекспир', 'Искусство', 1564, 1616, 'shakespeare.svg'),
  person('Сервантес', 'Искусство', 1547, 1616),
  person('Брейгель', 'Искусство', '1520-е', 1569),
  person('Бах', 'Искусство', 1685, 1750),
  { name: 'Греко-персидские войны', category: 'События', fm: { start: '499 BC', end: '449 BC' } },
  { name: 'Падение Рима', category: 'События', fm: { date: 476 } },
  { name: 'Крещение Руси', category: 'События', fm: { date: 'ок. 988' } },
  { name: 'Столетняя война', category: 'События', fm: { start: 1337, end: 1453 } },
  { name: 'Падение Константинополя', category: 'События', fm: { date: '1453-05-29' } },
  { name: 'Великие географические открытия', category: 'События', fm: { date: 'XVI век' } },
  { name: 'Непобедимая армада', category: 'События', fm: { date: 1588 } },
  { name: 'Тридцатилетняя война', category: 'События', fm: { period: '1618–1648' } },
  { name: 'Мировые войны', category: 'События', fm: { start: 1914, end: 1945 } },
  { name: 'Античность', category: 'Эпохи', fm: { start: '800 до н.э.', end: 476 } },
  { name: 'Средние века', category: 'Эпохи', fm: { start: 476, end: 1492 } },
  {
    name: 'Возрождение',
    category: 'Эпохи',
    fm: { start: 'вторая половина XIV века', end: '1600' },
  },
  { name: 'Новое время', category: 'Эпохи', fm: { start: 1600, end: 1914 } },
]

/** Drawn portraits: a circle of colour with initials, as SVG. */
export const HISTORY_COVERS: Record<string, string> = Object.fromEntries(
  (
    [
      ['socrates.svg', '#8e6cc9', 'Σ'],
      ['alexander.svg', '#d98a3a', 'AM'],
      ['ivan.svg', '#b5533c', 'ИГ'],
      ['galileo.svg', '#3a9d9b', 'G'],
      ['shakespeare.svg', '#c9577e', 'WS'],
    ] as const
  ).map(([file, color, text]) => [
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
      `<rect width="96" height="96" fill="${color}"/>` +
      `<circle cx="48" cy="38" r="18" fill="#fff" fill-opacity="0.85"/>` +
      `<path d="M16 96c4-22 18-32 32-32s28 10 32 32z" fill="#fff" fill-opacity="0.85"/>` +
      `<text x="48" y="44" font-family="sans-serif" font-size="16" text-anchor="middle" fill="${color}">${text}</text>` +
      `</svg>`,
  ])
)

/** A note's text: its frontmatter, the category it is grouped by, a line of body. */
export function historyNoteText(note: HistoryNote): string {
  const lines = Object.entries({ category: note.category, ...note.fm }).map(
    ([k, v]) => `${k}: ${typeof v === 'number' ? v : JSON.stringify(v)}`
  )
  return `---\n${lines.join('\n')}\n---\n\n${note.name}.\n`
}

/** The base: the folder's notes, grouped by category, on the timeline. */
export function historyBase(folder: string): string {
  return `filters:
  and:
    - file.inFolder("${folder}/Notes")
views:
  - type: abele-timeline
    name: History
    groupBy:
      property: note.category
      direction: ASC
`
}
