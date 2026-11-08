# Atlas spreadsheet dashboard

A browser based dashboard builder for Excel and CSV workbooks. It opens with an empty workspace; dashboards appear after you upload your own workbook.

## Run it

Deploy on Vercel or run locally with `vercel dev` to use the Gemini instruction endpoint in `api/insights.js`. In Vercel, add the key under **Project → Settings → Environment Variables** with the name `GEMINI_API_KEY` and type **Secret**, then redeploy. Never put the key in `app.js`, `index.html`, or a `NEXT_PUBLIC_` variable. Without a configured key, local spreadsheet parsing and direct dashboard controls still work, while AI instructions show a setup message.

Excel workbook parsing loads SheetJS from jsDelivr; workbook rows stay in the browser. AI instructions send the prompt, field names, column types, row counts, and current chart settings to Gemini; raw worksheet rows and cell values are not sent.

## Test it

Run `node --test "test/*.test.js"` (Node 22, no dependencies). `parser.js` holds the spreadsheet parsing and table detection with no DOM access, and `app.js` holds the dashboard. Add a file to `test/fixtures` whenever a real spreadsheet is misread. Date tests depend on the time zone, so also run them with `TZ=Asia/Kolkata` and `TZ=America/New_York`.

## Use it

- Upload one or more `.xlsx`, `.xls`, `.xlsm`, `.csv`, or `.tsv` files (up to 20 MB each). Atlas scans every worksheet automatically; it never asks you to choose one first.
- When you select several files together, Atlas combines their detected tables into one workspace and labels each view with its source workbook and worksheet.
- Atlas looks for headers and data tables even when a sheet has title rows or several tables. It recognizes common date and fiscal-period headings and reshapes wide period summaries into a trend-friendly view.
- Atlas opens the strongest detected table as a dashboard right away. Use **All sheets** to see every detected table and scanned worksheet, then open any view from its card or tab.
- Each dashboard includes summary cards, a trend chart, category and region breakdowns, insights, and a ranked table when the detected fields support them.
- Change the primary metric, grouping, chart style, filters, and number of ranked rows directly in the dashboard.
- Prices, rates, scores and ratio-style margins are averaged by default; amounts and counts are totalled. Switch with the Total/Average control or say “average price by region”.
- Comma, semicolon and tab separated files are detected, including European number and date formats such as `1.234,56` and `31.01.2025`.
- Total, subtotal and unlabelled total rows are left out of the numbers when their values add up, and the subtitle says how many were excluded.
- Add custom charts or enter instructions such as “show profit by region”, “filter to West”, “switch to a bar chart”, “show top 10”, or “what stands out?”
- Export the filtered source rows as CSV. Dates export as calendar dates, and text that a spreadsheet would run as a formula is prefixed with a quote.

Recognized instructions are applied locally. For more open-ended dashboard requests, the Gemini endpoint returns a structured action; the browser validates that action against the fields in the current workbook before changing the dashboard. The endpoint applies same-origin checks, request-size limits, and a best-effort per-IP rate limit.
