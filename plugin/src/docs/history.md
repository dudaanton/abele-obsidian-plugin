# History

Notes about history — people, events, wars, reigns, eras — and the timeline view a base draws
them on. How to write their dates so the timeline reads them, and how to make such notes.

## The timeline view

A `.base` file can show its notes on a line of years: a view with `type: abele-timeline`. People
are bars from birth to death, events are points, periods are bars, eras are drawn behind
everything. The base's `groupBy` makes the rows, each group its own colour. Its options sit in the
view's own entry and all of them may be left out:

```yaml
views:
  - type: abele-timeline
    name: History
    groupBy:
      property: note.category
      direction: ASC
    startProperty: note.born   # left out: guessed per note, see below
    endProperty: note.died
    periodProperty: note.period  # one field holding a whole span, "1914–1918"
    kindProperty: note.kind      # person, event, period or era
    coverProperty: note.cover    # a round picture on the bar and in the card
    weightProperty: note.weight  # who is labelled first when there is no room
    eraGroup: Эпохи              # the group drawn behind as eras
    aboutYears: 5                # how far "ок. 1450" reaches either way
```

With no start or end property set, each note is read by the first property it has of `start`,
`born`, `birth`, `date`, `year`, `from`, `begin`, `начало`, `рождение`, `дата`, `год`, and of
`end`, `died`, `death`, `until`, `to`, `конец`, `смерть` for the end. So people with
`born`/`died`, wars with `start`/`end` and battles with `date` sit in one base with no setup.
`period` (or `years`, `lifespan`, `период`, `годы`) is a whole span in one field; it only fills
in what `start` and `end` leave out. A group named `Эпохи`, `Эпоха`, `Eras` or `Era` is drawn as
eras unless `eraGroup` names another; a note whose kind property says `era` or `эпоха` is one too.

Nothing is stored anywhere but the `.base` file and the notes themselves. Without an importance
property, the notes linked to most are labelled first.

## Writing dates

Dates of history are **text properties**, not Obsidian dates: an Obsidian date cannot hold 490 BC,
"about 1450" or "the 16th century". An Obsidian date (`1564-04-26`) is still read. Write the date
the way a person would, in Russian or English:

| Write | Means |
|---|---|
| `1564`, `1564-04`, `1564-04-26` | a year, a month, a day |
| `26 апреля 1564`, `April 26, 1564` | a day in words |
| `1560-е`, `1560s` | a decade |
| `XVI век`, `16 век`, `16th century`, `XVI в.` | a century (the 16th is 1501–1600) |
| `начало XVI века`, `вторая половина XVI века`, `early 16th century` | a third, a half or a quarter of one |
| `III тыс. до н.э.`, `3rd millennium BC` | a millennium |
| `XVI–XVII вв.`, `V–IV вв. до н.э.` | from one century to another |
| `ок. 1450`, `~1450`, `c. 1450` | about a year |
| `1450?` | perhaps that year |
| `1440–1455` in a start or end field | somewhere between — not a span |
| `490 до н.э.`, `490 BC`, `-490` | before Christ |
| `сейчас`, `now`, `present` | still going |

**A negative year is BC the way people count**: `-490` is 490 BC. It is not the EDTF or
astronomical `-0489`; there is no year zero, and `0` is not read — the note counts as undated. The label on the timeline shows a vague date as
written, so keep the wording you want seen: `ок. 1450`, not a made-up `1450`.

## Making historical notes

- A person: `born` and `died`. Unknown death: leave `died` out — a person born over 120 years ago
  is then drawn fading out, a later one as alive.
- An event on one date: `date`. A long one (a war, a reign): `start` and `end`, or `period`.
- An era: `start` and `end`, in the base's eras group, or `kind: era`.
- `cover`: a picture in the vault, `"[[portrait.jpg]]"`, drawn round on the bar.
- Put the group's property (`category` in the example) on every note so it lands in its row.
- Never change the wording of a vague date to make it sort: the base's table sorts these as text,
  the timeline does not need it to.
