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

An account is a note with a `type`: `asset`, `revenue`, `expense` or `liability`. The accounts on
each side of a transaction decide what it means:

- `revenue` to `asset` is income;
- `asset` to `expense` is spending;
- `asset` to `asset` is a transfer, and changes no total.

Account notes live in the accounts folder (`Finance/Accounts` by default). An account note shows
its balance over time and its transactions under the text.

## Several currencies

A transaction in two currencies gives the amount in both, as Firefly III does. Set your main
currency and the currencies shown first in **Settings → Abele → Finance**.

## The finance sidebar

**Show finance sidebar** opens income, expenses and savings for a period you pick, charts of
where the money went, the transactions themselves, and debts: what you owe and what is owed to
you.

The search icon above its transactions looks through all of them, whatever the period; under a
note it looks only through that note's transactions. What is found stays grouped by day.

**Show accounts sidebar** lists every account with its balance. Its options sort the list, group
it by account type, hide empty accounts and pick one currency.

## Moving from Firefly III

**Migrate data from Firefly III** copies accounts, categories and transactions from a Firefly III server. Its
address and token go in **Settings → Abele → Finance**. The token is kept in the device's
keychain, not in the settings.
