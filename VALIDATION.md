# Validation Report

## Overall assessment: Ready to share with caveats

### Methodology review

- Source: uploaded `credit_card_fraud_2025.csv`, treated as one row per unique transaction.
- Scope: descriptive fraud and financial-risk analytics; no predictive model or causal claim.
- Metric definitions: fraud rate uses all transactions as the denominator; fraud loss is the sum of `Amount` where `Fraud_Flag = 1`.
- Card presence and authentication are explicitly derived because the source does not provide those fields directly.

### Data-quality checks

- 500,000 rows and 16 original columns.
- 0 missing cells, 0 exact duplicates, and 0 duplicated transaction IDs.
- 0 invalid dates, non-positive amounts, negative distances, invalid binary flags, invalid hours, or timestamp/hour mismatches.
- All 500,000 rows remain after cleaning.

### Calculation spot-checks

- Python and SQLite independently reconcile to 500,000 total transactions and 7,500 fraud transactions.
- Fraud rate reconciles to exactly 1.50%.
- Total amount reconciles to $72,634,006.83.
- Fraud loss reconciles to $1,088,218.66; `$1.09M` is valid rounding.
- Average fraud amount reconciles to $145.09582133 ($145.10 displayed).
- Excel KPI formulas reconcile to the same figures and the workbook formula-error scan returns no matches.

### Visualization review

- All six workbook sheets were rendered and visually inspected.
- KPI values, titles, filters, tables, chart labels, number formats, and chart placements are readable at the delivered layout.
- Standard magnitude bars start at zero; percentage axes are explicitly formatted.

### Required caveats

- Source provenance and currency are unavailable. Dollar formatting is a presentation assumption inherited from the resume claim.
- Channel and card-presence differences are extremely small and should not be presented as material risk effects.
- Segment rankings are descriptive; multiple comparisons can create chance extremes.
- The Excel row-level tabs include the first 10,000 rows for performance. Full 500,000-row raw and cleaned CSV files and all full-data aggregates are included.
- The notebook structure and code-cell syntax were validated, and the equivalent Python analysis executed successfully. The notebook itself was not executed in the build environment because Jupyter was unavailable there; install `requirements.txt` and use **Run All** in VS Code/Jupyter.
