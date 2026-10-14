# Finance

A money tracker where every transaction is a note, linked to accounts, categories and anything
else it relates to.

## Transactions

Run **Create new transaction**. Its note carries:

| Property | Meaning |
|---|---|
| `date` | When it happened |
| `from`, `to` | Links to the account the money left and the one it went to |
| `amount`, `currency` | How much, always positive |
| `foreignAmount`, `foreignCurrency` | The same sum in a second currency |
| `category` | A link to a category note |
| `groups` | Anything it relates to: a trip, a project, a person |

**Create new transaction and insert into current note** also leaves a link to it at the cursor.
Where new transactions go, and which template they are made from, is set in
**Settings → Abele → Finance**.

## Accounts

An account is a note with `type: account` and an `accountType`: `asset`, `revenue`, `expense`,
`liability`, `computed` or `mixed`. The accounts on each side of a transaction decide what it means:

- `revenue` to `asset` is income;
- `asset` to `expense` is spending;
- `mixed` to `asset` or `liability` is income;
- `asset` or `liability` to `mixed` is spending;
- `mixed` to `mixed` is a neutral transfer;
- `asset` to `asset` is a transfer, and changes no total.

Mixed accounts are categories with no fixed currency. The same category appears in income and
expenses according to each transaction's direction, and never in net worth. Its account chart
shows both directions separately. Its accounts-list row is signed net category flow, per
currency. Set `accountType` to `mixed` in the note's ordinary Properties editor.

Account notes live in the accounts folder (`Finance/Accounts` by default). An account note shows
its balance over time and its transactions under the text.

## Several currencies

A transaction in two currencies gives the amount in both, as Firefly III does. Set your main
currency and the currencies shown first in **Settings → Abele → Finance**.

When your money is in more than one currency, Abele adds it up at today's exchange rates: one
balance of everything at the top of the finance sidebar, a **≈ USD** tab for the period with its
pie and calendar, a dashed total on the net worth chart, and accounts sorted by size or balance by
what they are worth in dollars. A computed account whose sources are in different currencies
converts them into its own. Every such figure starts with `≈` and is approximate: today's rate
stands for every past day. Its tooltip gives the day of the rates, the rate of each currency and
the source. The exact sums in each currency stay where they were.

The rates are a public table fetched once a day without a key, from Frankfurter, with
currency-api for currencies it does not have, such as crypto. They are kept on the device, so
nothing breaks offline; rates older than four days get an orange dot. A currency with no rate is
left out of the sum and marked with a dashed ring. **Settings → Abele → Finance → Exchange rates**
turns fetching off, changes the currency sums are shown in, and shows where the rates stand.

## The finance sidebar

**Show finance sidebar** opens income, expenses and savings for a period you pick, charts of
where the money went, the transactions themselves, and debts: what you owe and what is owed to
you.

The search icon above its transactions looks through all of them, whatever the period; under a
note it looks only through that note's transactions. What is found stays grouped by day.

**Show accounts sidebar** lists every account with its balance. Its options sort the list, group
it by account type, hide empty accounts and pick one currency.

## Asking an agent about your money

An agent in the chat can total, average and compare your transactions and balances exactly —
per category, per month, per account — and show a trend, a rough forecast or unusual spending.
Amounts in different currencies are kept apart, or converted with the rates your own
two-currency transactions imply; the answer says which rates it used.

## Moving from Firefly III

**Migrate data from Firefly III** copies accounts, categories and transactions from a Firefly III server. Its
address and token go in **Settings → Abele → Finance**. The token is kept in the device's
keychain, not in the settings.
