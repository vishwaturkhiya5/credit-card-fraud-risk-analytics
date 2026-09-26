"""Create a standards-compliant reader-facing .ipynb using Python's stdlib."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "notebooks" / "fraud_risk_analysis.ipynb"


def markdown(source: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": source.splitlines(keepends=True)}


def code(source: str) -> dict:
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": source.splitlines(keepends=True)}


def main() -> None:
    cells = [
        markdown(
            "# Credit Card Fraud Detection & Financial Risk Analytics\n\n"
            "## tl;dr\nThis notebook reproduces the verified KPIs, quality checks, segment analysis, and time trends from the supplied CSV. "
            "Run all cells after installing `requirements.txt`."
        ),
        markdown(
            "## Context & Methods\n\n**Decision use:** monitor fraud exposure and identify segments for review.  \n"
            "**Unit of analysis:** one unique `Transaction_ID`.  \n"
            "**Fraud rate:** fraudulent transactions / all transactions.  \n"
            "**Fraud loss:** sum of `Amount` where `Fraud_Flag = 1`.\n\n"
            "### Key Assumptions\n- `Online` is card-not-present; `POS` and `ATM` are card-present.\n"
            "- Authentication is derived from the chip and PIN flags.\n"
            "- Segment differences are descriptive, not causal or predictive."
        ),
        code(
            "from pathlib import Path\nimport sys\nimport pandas as pd\nimport matplotlib.pyplot as plt\n\n"
            "ROOT = Path.cwd()\nif not (ROOT / 'data' / 'raw').exists():\n    ROOT = ROOT.parent\n"
            "sys.path.insert(0, str(ROOT / 'python'))\n"
            "from fraud_analysis import load_and_clean_data, build_analysis_tables\n"
            "RAW_FILE = ROOT / 'data' / 'raw' / 'credit_card_fraud_2025.csv'"
        ),
        markdown("## Data\n\n### 1. Load, validate, and clean"),
        code("cleaned, quality_report = load_and_clean_data(RAW_FILE)\nquality_report"),
        code(
            "pd.DataFrame({\n    'Column': cleaned.columns,\n    'Data_Type': cleaned.dtypes.astype(str).values,\n"
            "    'Missing_Values': cleaned.isna().sum().values,\n    'Distinct_Values': cleaned.nunique(dropna=False).values,\n})"
        ),
        markdown("## Results\n\n### 2. Calculate verified KPIs"),
        code("tables, kpis = build_analysis_tables(cleaned)\npd.DataFrame({'KPI': kpis.keys(), 'Value': kpis.values()})"),
        markdown("### 3. Compare channel, card-presence, and authentication risk"),
        code("display(tables['fraud_by_channel'])\ndisplay(tables['fraud_by_card_presence'])\ndisplay(tables['fraud_by_authentication'])"),
        markdown("### 4. Review geographic and merchant-category exposure"),
        code("display(tables['fraud_by_country'].head(10))\ndisplay(tables['fraud_by_category'].head(10))"),
        markdown("### 5. Inspect time trends"),
        code(
            "monthly = tables['monthly_fraud_trend']\n"
            "ax = monthly.plot(x='Month', y='Fraud_Rate', marker='o', figsize=(11, 4.5), color='#2F6B9A', legend=False)\n"
            "ax.set_title('Monthly Fraud Rate Trend')\nax.set_ylabel('Fraud rate')\n"
            "ax.yaxis.set_major_formatter(lambda x, pos: f'{x:.2%}')\n"
            "plt.xticks(rotation=45, ha='right')\nplt.tight_layout()"
        ),
        markdown("### 6. Review suspicious patterns and stable-volume segment rankings"),
        code("display(tables['suspicious_patterns'])\ndisplay(tables['high_risk_segments'].head(15))"),
        markdown(
            "## Takeaways\n\n- Resume fraud-rate and fraud-loss figures reconcile to the source rows.\n"
            "- Channel and card-presence rates are very close; no material channel effect is established.\n"
            "- Rankings are descriptive and should be interpreted with volume and multiple-comparison caution.\n"
            "- High-value transactions matter operationally because each fraud event has larger loss impact."
        ),
    ]
    notebook = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    OUTPUT.write_text(json.dumps(notebook, indent=1), encoding="utf-8")
    loaded = json.loads(OUTPUT.read_text(encoding="utf-8"))
    assert loaded["nbformat"] == 4 and loaded["cells"]
    for cell in loaded["cells"]:
        if cell["cell_type"] == "code":
            compile("".join(cell["source"]), str(OUTPUT), "exec")
    print(f"Notebook created and structurally validated: {OUTPUT}")


if __name__ == "__main__":
    main()
