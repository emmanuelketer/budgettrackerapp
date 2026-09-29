# Budget Tracker

A small personal budget tracker that runs entirely in the browser. It has no build step, no backend and no account. Your data stays in your browser's `localStorage`.

## Features

- **Income and expenses.** Add, edit and delete transactions, each with an amount, category, date and optional description.
- **Monthly view.** Step through months to see that month's income, expenses and balance.
- **Category budgets.** Set a monthly limit per expense category. Progress bars turn amber at 80% and red once you go over.
- **Search and filter.** Search transactions by description or category, and filter by income or expense.
- **Currencies.** Choose KES (the default), USD, EUR, GBP, NGN, UGX, TZS or INR. Amounts are formatted with `Intl.NumberFormat`.
- **Light and dark themes.** The app follows your system setting until you use the toggle, and then it remembers your choice.
- **Backup and export.** Export all your data as JSON and import it again, or export transactions as CSV for a spreadsheet.
- **Multi-tab sync.** Changes made in one tab show up in any other open tab.

### Categories

| Type    | Categories |
|---------|------------|
| Expense | Food, Transport, Friends, Family, Entertainment, Savings, Investment, Other |
| Income  | Salary, Business, Freelance, Gifts, Friends, Family, Other |

To change these, edit the `CATEGORIES` constant at the top of [app.js](app.js).

## Getting started

There is nothing to install. Open `index.html` in a browser.

To serve it locally instead, run any static file server from the project folder:

```bash
# Python
python -m http.server 8000

# or Node
npx serve .
```

Then go to http://localhost:8000.

An internet connection is needed only for the Google Fonts stylesheet and the GSAP script, both loaded from CDNs. Without them the app still works, using fallback fonts.

## Project structure

```
index.html   Page markup and layout
styles.css   Styling, design tokens and the light/dark themes
app.js       All application logic (state, rendering, events)
```

`app.js` is a single self-contained IIFE, split into these sections:

- **State & persistence:** `loadState`, `saveState`, and `normalizeState`, which validates stored or imported data
- **Helpers:** date and month utilities, currency formatting, DOM helpers, toast notifications
- **Theme:** applying and toggling light or dark mode
- **Rendering:** the summary, budget progress and the transaction list
- **Transactions:** the add/edit form and deletion
- **Budgets:** the budget limit editor
- **Import / export:** JSON backup, CSV export, import and clearing all data

## Data format

Data is stored under the `localStorage` key `budgetTracker.v1`. It has the same shape as the JSON export:

```json
{
  "transactions": [
    {
      "id": "lz3k9a1b2c3",
      "type": "expense",
      "amount": 450,
      "category": "Food",
      "description": "Lunch with friends",
      "date": "2026-09-29"
    }
  ],
  "budgets": { "Food": 10000, "Transport": 4000 },
  "settings": { "currency": "KES", "theme": null }
}
```

On import, the data is checked. Transactions with an invalid type, a non-positive amount or a malformed date are dropped. Missing fields are filled with defaults, and descriptions are cut to 80 characters. **Importing replaces your current data**, so export a backup first if you need one.

## Privacy

All data stays on your device. Clearing your browser's site data, or using a private window, will erase it. Use **Export JSON** regularly if you want a backup, or to move your data to another device or browser.

## Author
- [@emmanuelketer](https://github.com/emmanuelketer)
