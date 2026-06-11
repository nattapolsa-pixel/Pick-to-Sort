How to inspect the "Data" sheet locally

1) In Google Sheets, open the sheet "Data" (the tab you linked).
2) File → Download → Comma-separated values (.csv, current sheet)
3) Save the file to the project folder, e.g. `data.csv` at the repository root.

Run the analyzer (requires Node.js):

```bash
node tools/inspect_sheet.js data.csv
```

The script will print:
- total rows
- detected headers
- detected `qty` and shift columns
- total qty and breakdown by shift (it prefers `pickShift` column, falls back to `sortShift`, else `unassigned`)

If you want, attach the exported `data.csv` here and I will inspect it for you and report findings.