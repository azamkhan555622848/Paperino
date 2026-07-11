---
name: xlsx
description: "Use this skill any time a spreadsheet file is the primary input or output. This means any task where the user wants to: open, read, edit, or fix an existing .xlsx, .xlsm, .xltx, .csv, or .tsv file (e.g., adding columns, computing formulas, formatting, charting, cleaning messy data); create a new spreadsheet from scratch or from other data sources; or convert between tabular file formats. Trigger especially when the user references a spreadsheet file by name or path — even casually (like \"the xlsx in my downloads\") — and wants something done to it or produced from it. Also trigger for cleaning or restructuring messy tabular data files (malformed rows, misplaced headers, junk data) into proper spreadsheets. The deliverable must be a spreadsheet file. Do NOT trigger when the primary deliverable is a Word document, HTML report, standalone Python script, database pipeline, or Google Sheets API integration, even if tabular data is involved."
license: Proprietary (Anthropic). Adapted for Paperino on Windows; see the upstream skill for complete terms.
---

# Paperino rules — these override everything below

1. **`artifacts/` is read-only ground truth.** Never open a workbook in `artifacts/` for
   editing and never write back to it. Copy it out first and work on the copy. The recalc
   script *saves the file it is given* — pointing it at `artifacts/` would rewrite the
   user's raw data.
2. **A number you did not read is a number you may not write.** Reading values out of a
   spreadsheet is how you *get* results; it is not licence to produce them. If a cell the
   user expects is empty or a column is missing, say so and ask. Never fill a gap with a
   plausible figure.
3. **Numbers headed for a figure or a LaTeX table go through the data pipeline**, not
   through your fingers: pull them with the `figures` tools' `data_query` into `data.json`.
   Retyping a value into `figure.html` is a hard lint failure (rule 8, `provenance`).
4. **To *show* the user a spreadsheet, don't paste a summary.** They can click it in the
   Preview panel's file tree. If they want it as a document, convert it to PDF and write
   that to `.paperino/preview.pdf`.

# Environment (Windows)

`python` inside Paperino is already the skill venv (`tools/pyoffice/.venv`, also exported as
`$PAPERINO_PYTHON`). It has **openpyxl, pandas and pywin32**.

**Formula recalculation runs on real Excel over COM**, not LibreOffice — LibreOffice is not
installed. `scripts/recalc.py` wraps it and keeps the same JSON contract described below.
There is no `extract-text` CLI here; use pandas.

If a script fails with `ModuleNotFoundError`, the venv is missing — run
`opencode-dev\paperino-config\skill\setup.cmd` once and say so; do not improvise around it.

# Requirements for Outputs

## All Excel files

### Professional Font
- Use a consistent, professional font (e.g., Arial, Times New Roman) for all deliverables unless otherwise instructed by the user

### Zero Formula Errors
- Every Excel model MUST be delivered with ZERO formula errors (#REF!, #DIV/0!, #VALUE!, #N/A, #NAME?)

### Preserve Existing Templates (when updating templates)
- Study and EXACTLY match existing format, style, and conventions when modifying files
- Never impose standardized formatting on files with established patterns
- Existing template conventions ALWAYS override these guidelines

## Financial models

(Applies to financial models specifically. A table of experimental results is not a
financial model — do not colour-code a results table blue and black.)

### Color Coding Standards
Unless otherwise stated by the user or existing template

#### Industry-Standard Color Conventions
- **Blue text (RGB: 0,0,255)**: Hardcoded inputs, and numbers users will change for scenarios
- **Black text (RGB: 0,0,0)**: ALL formulas and calculations
- **Green text (RGB: 0,128,0)**: Links pulling from other worksheets within same workbook
- **Red text (RGB: 255,0,0)**: External links to other files
- **Yellow background (RGB: 255,255,0)**: Key assumptions needing attention or cells that need to be updated

### Number Formatting Standards

#### Required Format Rules
- **Years**: Format as text strings (e.g., "2024" not "2,024")
- **Currency**: Use $#,##0 format; ALWAYS specify units in headers ("Revenue ($mm)")
- **Zeros**: Use number formatting to make all zeros "-", including percentages (e.g., "$#,##0;($#,##0);-")
- **Percentages**: Default to 0.0% format (one decimal)
- **Multiples**: Format as 0.0x for valuation multiples (EV/EBITDA, P/E)
- **Negative numbers**: Use parentheses (123) not minus -123

### Formula Construction Rules

#### Assumptions Placement
- Place ALL assumptions (growth rates, margins, multiples, etc.) in separate assumption cells
- Use cell references instead of hardcoded values in formulas
- Example: Use =B5*(1+$B$6) instead of =B5*1.05

#### Formula Error Prevention
- Verify all cell references are correct
- Check for off-by-one errors in ranges
- Ensure consistent formulas across all projection periods
- Test with edge cases (zero values, negative numbers)
- Verify no unintended circular references

#### Documentation Requirements for Hardcodes
- Comment or in cells beside (if end of table). Format: "Source: [System/Document], [Date], [Specific Reference], [URL if applicable]"
- Examples:
  - "Source: Company 10-K, FY2024, Page 45, Revenue Note, [SEC EDGAR URL]"
  - "Source: measurement run 2026-03-14, artifacts/runs/run-14.csv, column `latency_ms`"
  - "Source: Bloomberg Terminal, 8/15/2025, AAPL US Equity"

# XLSX creation, editing, and analysis

## Reading and analyzing data

### Quick dump

```python
import pandas as pd

for name, frame in pd.read_excel("file.xlsx", sheet_name=None).items():  # .xlsm works too
    print(f"## Sheet: {name}")
    print(frame.head(50).to_string())
```

### Data analysis with pandas

```python
import pandas as pd

df = pd.read_excel('file.xlsx')                            # first sheet
all_sheets = pd.read_excel('file.xlsx', sheet_name=None)   # every sheet, as a dict

df.head()      # Preview data
df.info()      # Column info
df.describe()  # Statistics

df.to_excel('output.xlsx', index=False)
```

## CRITICAL: Use Formulas, Not Hardcoded Values

**Always use Excel formulas instead of calculating values in Python and hardcoding them.**
This keeps the spreadsheet dynamic and updateable.

### ❌ WRONG — Hardcoding Calculated Values
```python
total = df['Sales'].sum()
sheet['B10'] = total          # hardcodes 5000

growth = (df.iloc[-1]['Revenue'] - df.iloc[0]['Revenue']) / df.iloc[0]['Revenue']
sheet['C5'] = growth          # hardcodes 0.15
```

### ✅ CORRECT — Using Excel Formulas
```python
sheet['B10'] = '=SUM(B2:B9)'
sheet['C5'] = '=(C4-C2)/C2'
sheet['D20'] = '=AVERAGE(D2:D19)'
```

This applies to ALL calculations — totals, percentages, ratios, differences. The spreadsheet
must recalculate when its source data changes.

## Common Workflow

1. **Choose tool**: pandas for data, openpyxl for formulas/formatting
2. **Create/Load**: new workbook, or `load_workbook` an existing one
3. **Modify**: data, formulas, formatting
4. **Save**
5. **Recalculate (MANDATORY IF YOU WROTE FORMULAS)** — openpyxl writes formulas as *strings*
   with no cached value, so a file it saved shows blanks until Excel evaluates it:
   ```bash
   python scripts/recalc.py output.xlsx          # optional 2nd arg: timeout seconds (default 120)
   ```
6. **Verify and fix every error**:
   - `status: "errors_found"` → read `error_summary` for the type and the exact cells
   - fix, then recalculate again, until `status: "success"`
   - `#REF!` bad reference · `#DIV/0!` division by zero · `#VALUE!` wrong type ·
     `#NAME?` unknown function · `#N/A` lookup missed

### Creating new Excel files

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

wb = Workbook()
sheet = wb.active

sheet['A1'] = 'Hello'
sheet.append(['Row', 'of', 'data'])
sheet['B2'] = '=SUM(A1:A10)'

sheet['A1'].font = Font(bold=True, color='FF0000')
sheet['A1'].fill = PatternFill('solid', start_color='FFFF00')
sheet['A1'].alignment = Alignment(horizontal='center')
sheet.column_dimensions['A'].width = 20

wb.save('output.xlsx')
```

### Editing existing Excel files

```python
from openpyxl import load_workbook

wb = load_workbook('existing.xlsx')     # preserves formulas and formatting
sheet = wb.active                       # or wb['SheetName']

for sheet_name in wb.sheetnames:
    print(sheet_name)

sheet['A1'] = 'New Value'
sheet.insert_rows(2)
sheet.delete_cols(3)
wb.create_sheet('NewSheet')['A1'] = 'Data'

wb.save('modified.xlsx')
```

## Recalculating formulas

```bash
python scripts/recalc.py <excel_file> [timeout_seconds]
```

The script drives a **private** Excel instance (never the one the user has open), forces a
full rebuild, saves in the original format (`.xlsm` stays macro-enabled), scans every sheet
for error cells, and always closes Excel behind itself. Macros are disabled on open, so an
untrusted `.xlsm` cannot run code.

### Interpreting its output

```json
{
  "status": "success",
  "total_errors": 0,
  "total_formulas": 42,
  "error_summary": {
    "#REF!": { "count": 2, "locations": ["Sheet1!B5", "Sheet1!C10"] }
  }
}
```

`error_summary` appears only when errors were found. If the file cannot be opened at all you
get `{"status": "error", "message": …}` and a non-zero exit — report that, don't retry blindly.

## Formula Verification Checklist

### Essential Verification
- [ ] **Test 2-3 sample references**: verify they pull the right values before building the full model
- [ ] **Column mapping**: confirm Excel columns match (column 64 = BL, not BK)
- [ ] **Row offset**: Excel rows are 1-indexed (DataFrame row 5 = Excel row 6)

### Common Pitfalls
- [ ] **NaN handling**: check nulls with `pd.notna()`
- [ ] **Far-right columns**: full-year data often sits in columns 50+
- [ ] **Multiple matches**: search all occurrences, not just the first
- [ ] **Division by zero**: check denominators (#DIV/0!)
- [ ] **Wrong references**: verify every reference points where you think (#REF!)
- [ ] **Cross-sheet references**: `Sheet1!A1` form

### Formula Testing Strategy
- [ ] **Start small**: 2–3 cells before applying broadly
- [ ] **Verify dependencies**: every referenced cell exists
- [ ] **Test edge cases**: zero, negative, very large

## Best Practices

### Library Selection
- **pandas**: data analysis, bulk operations, simple export
- **openpyxl**: formatting, formulas, Excel-specific features

### Working with openpyxl
- Cell indices are 1-based (row=1, column=1 is A1)
- `load_workbook('f.xlsx', data_only=True)` reads *calculated values*
- **Warning**: a workbook opened with `data_only=True` and then saved has its formulas
  replaced by values — permanently lost
- Large files: `read_only=True` / `write_only=True`
- Formulas are preserved but never evaluated — that is what `scripts/recalc.py` is for

### Working with pandas
- Pin dtypes to avoid inference surprises: `pd.read_excel('f.xlsx', dtype={'id': str})`
- Read only what you need: `usecols=['A', 'C', 'E']`
- Dates: `parse_dates=['date_column']`

## Code Style Guidelines

**When generating Python for Excel work**: write minimal, concise code — no verbose names,
no redundant operations, no decorative print statements.

**In the Excel file itself**: comment cells with complex formulas or key assumptions, and
document the source of every hardcoded number (see above).
