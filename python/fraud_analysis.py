"""Credit Card Fraud Detection & Financial Risk Analytics.

Beginner-friendly, reproducible analysis for the supplied 2025 transaction CSV.
Run from the project root:
    python python/fraud_analysis.py
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_FILE = PROJECT_ROOT / "data" / "raw" / "credit_card_fraud_2025.csv"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
EXPORT_DIR = PROJECT_ROOT / "data" / "exports"
IMAGE_DIR = PROJECT_ROOT / "images"

REQUIRED_COLUMNS = {
    "Transaction_ID", "Customer_ID", "Transaction_Date", "Amount",
    "Merchant_Category", "Merchant_ID", "Card_Type", "Transaction_Type",
    "Country", "Is_International", "Is_Chip", "Is_Pin_Used",
    "Distance_From_Home", "Hour_of_Day", "Device_Type", "Fraud_Flag",
}

PALETTE = {
    "navy": "#102A43", "blue": "#2F6B9A", "gold": "#D9A441",
    "orange": "#D97706", "light": "#EAF2F8", "gray": "#718096",
}


def load_and_clean_data(path: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load, validate, clean, and enrich the transaction-level dataset."""
    raw = pd.read_csv(path, low_memory=False)
    raw.columns = raw.columns.str.strip()
    missing_columns = REQUIRED_COLUMNS.difference(raw.columns)
    if missing_columns:
        raise ValueError(f"Missing required columns: {sorted(missing_columns)}")

    checks: list[dict[str, object]] = []
    checks.append({"check": "Source rows", "value": len(raw), "status": "Observed"})
    checks.append({"check": "Source columns", "value": raw.shape[1], "status": "Observed"})
    checks.append({"check": "Missing cells", "value": int(raw.isna().sum().sum()), "status": "Checked"})
    checks.append({"check": "Exact duplicate rows", "value": int(raw.duplicated().sum()), "status": "Checked"})
    checks.append({"check": "Duplicate Transaction_ID", "value": int(raw["Transaction_ID"].duplicated().sum()), "status": "Checked"})

    df = raw.copy()
    text_columns = ["Merchant_Category", "Card_Type", "Transaction_Type", "Country", "Device_Type"]
    for column in text_columns:
        df[column] = df[column].astype("string").str.strip()

    numeric_columns = [
        "Transaction_ID", "Customer_ID", "Amount", "Merchant_ID", "Is_International",
        "Is_Chip", "Is_Pin_Used", "Distance_From_Home", "Hour_of_Day", "Fraud_Flag",
    ]
    for column in numeric_columns:
        df[column] = pd.to_numeric(df[column], errors="coerce")

    df["Transaction_Date"] = pd.to_datetime(
        df["Transaction_Date"], format="%d-%m-%Y %H:%M", errors="coerce"
    )

    invalid_date = df["Transaction_Date"].isna()
    invalid_amount = df["Amount"].isna() | (df["Amount"] <= 0)
    invalid_distance = df["Distance_From_Home"].isna() | (df["Distance_From_Home"] < 0)
    invalid_hour = ~df["Hour_of_Day"].between(0, 23, inclusive="both")
    binary_columns = ["Is_International", "Is_Chip", "Is_Pin_Used", "Fraud_Flag"]
    invalid_binary = ~df[binary_columns].isin([0, 1]).all(axis=1)
    missing_required = df[list(REQUIRED_COLUMNS)].isna().any(axis=1)

    checks.extend([
        {"check": "Invalid dates", "value": int(invalid_date.sum()), "status": "Checked"},
        {"check": "Non-positive/invalid amounts", "value": int(invalid_amount.sum()), "status": "Checked"},
        {"check": "Negative/invalid distance", "value": int(invalid_distance.sum()), "status": "Checked"},
        {"check": "Invalid hour", "value": int(invalid_hour.sum()), "status": "Checked"},
        {"check": "Invalid binary flags", "value": int(invalid_binary.sum()), "status": "Checked"},
        {"check": "Rows missing required values", "value": int(missing_required.sum()), "status": "Checked"},
    ])

    invalid_row = invalid_date | invalid_amount | invalid_distance | invalid_hour | invalid_binary | missing_required
    df = df.loc[~invalid_row].drop_duplicates().drop_duplicates("Transaction_ID", keep="first").copy()

    for column in ["Transaction_ID", "Customer_ID", "Merchant_ID", "Hour_of_Day"] + binary_columns:
        df[column] = df[column].astype("int64")

    # Dataset-backed definitions used throughout the project.
    df["Card_Presence"] = np.where(df["Transaction_Type"].eq("Online"), "Card-Not-Present", "Card-Present")
    df["Authentication_Method"] = np.select(
        [
            df["Is_Chip"].eq(1) & df["Is_Pin_Used"].eq(1),
            df["Is_Chip"].eq(1) & df["Is_Pin_Used"].eq(0),
            df["Is_Chip"].eq(0) & df["Is_Pin_Used"].eq(1),
        ],
        ["Chip + PIN", "Chip only", "PIN only"],
        default="Neither chip nor PIN",
    )
    df["Month"] = df["Transaction_Date"].dt.to_period("M").astype(str)
    df["Week_Start"] = (df["Transaction_Date"] - pd.to_timedelta(df["Transaction_Date"].dt.weekday, unit="D")).dt.date.astype(str)
    df["Day_of_Week"] = df["Transaction_Date"].dt.day_name()
    df["Fraud_Amount"] = np.where(df["Fraud_Flag"].eq(1), df["Amount"], 0.0)

    high_value_threshold = float(df["Amount"].quantile(0.99))
    far_distance_threshold = float(df["Distance_From_Home"].quantile(0.99))
    df["High_Value_Flag"] = df["Amount"].ge(high_value_threshold).astype(int)
    df["Far_From_Home_Flag"] = df["Distance_From_Home"].ge(far_distance_threshold).astype(int)
    df["Off_Hours_Flag"] = df["Hour_of_Day"].between(0, 5, inclusive="both").astype(int)

    mismatched_hour = int((df["Transaction_Date"].dt.hour != df["Hour_of_Day"]).sum())
    checks.append({"check": "Timestamp/hour mismatches", "value": mismatched_hour, "status": "Checked"})
    checks.append({"check": "Rows after cleaning", "value": len(df), "status": "Result"})
    checks.append({"check": "99th percentile amount threshold", "value": round(high_value_threshold, 2), "status": "Derived"})
    checks.append({"check": "99th percentile distance threshold", "value": round(far_distance_threshold, 2), "status": "Derived"})
    return df, pd.DataFrame(checks)


def segment_summary(df: pd.DataFrame, dimension: str) -> pd.DataFrame:
    """Return transaction volume, fraud count/rate, amount, and fraud loss by segment."""
    result = (
        df.groupby(dimension, dropna=False)
        .agg(
            Total_Transactions=("Transaction_ID", "size"),
            Fraudulent_Transactions=("Fraud_Flag", "sum"),
            Total_Amount=("Amount", "sum"),
            Fraud_Loss=("Fraud_Amount", "sum"),
        )
        .reset_index()
    )
    result["Legitimate_Transactions"] = result["Total_Transactions"] - result["Fraudulent_Transactions"]
    result["Fraud_Rate"] = result["Fraudulent_Transactions"] / result["Total_Transactions"]
    result["Average_Fraud_Amount"] = result["Fraud_Loss"] / result["Fraudulent_Transactions"].replace(0, np.nan)
    return result.sort_values(["Fraud_Rate", "Fraudulent_Transactions"], ascending=[False, False])


def pattern_summary(df: pd.DataFrame, pattern: pd.Series, label: str) -> dict[str, object]:
    subset = df.loc[pattern]
    return {
        "Pattern": label,
        "Total_Transactions": len(subset),
        "Fraudulent_Transactions": int(subset["Fraud_Flag"].sum()),
        "Fraud_Rate": float(subset["Fraud_Flag"].mean()) if len(subset) else np.nan,
        "Fraud_Loss": float(subset["Fraud_Amount"].sum()),
    }


def dashboard_cube(df: pd.DataFrame, breakdown: str | None = None) -> pd.DataFrame:
    """Create a compact aggregation cube for responsive Excel dashboard formulas."""
    dimensions = ["Country", "Card_Type", "Device_Type"]
    if breakdown:
        dimensions.append(breakdown)
    return (
        df.groupby(dimensions, dropna=False)
        .agg(
            Total_Transactions=("Transaction_ID", "size"),
            Fraudulent_Transactions=("Fraud_Flag", "sum"),
            Total_Amount=("Amount", "sum"),
            Fraud_Loss=("Fraud_Amount", "sum"),
        )
        .reset_index()
    )


def build_analysis_tables(df: pd.DataFrame) -> tuple[dict[str, pd.DataFrame], dict[str, object]]:
    fraud = df["Fraud_Flag"].eq(1)
    kpis = {
        "Total Transactions": int(len(df)),
        "Fraudulent Transactions": int(fraud.sum()),
        "Legitimate Transactions": int((~fraud).sum()),
        "Fraud Rate": float(fraud.mean()),
        "Total Transaction Amount": float(df["Amount"].sum()),
        "Total Fraud Loss": float(df.loc[fraud, "Amount"].sum()),
        "Average Fraud Amount": float(df.loc[fraud, "Amount"].mean()),
        "Data Start Date": df["Transaction_Date"].min().isoformat(),
        "Data End Date": df["Transaction_Date"].max().isoformat(),
        "Amount P99": float(df["Amount"].quantile(0.99)),
        "Distance P99": float(df["Distance_From_Home"].quantile(0.99)),
    }

    monthly = segment_summary(df, "Month").sort_values("Month")
    weekly = segment_summary(df, "Week_Start").sort_values("Week_Start")
    hourly = segment_summary(df, "Hour_of_Day").sort_values("Hour_of_Day")

    # Multi-dimensional segments; minimum size avoids ranking tiny, unstable groups.
    combo = (
        df.groupby(["Transaction_Type", "Authentication_Method", "Is_International", "Device_Type"])
        .agg(
            Total_Transactions=("Transaction_ID", "size"),
            Fraudulent_Transactions=("Fraud_Flag", "sum"),
            Fraud_Loss=("Fraud_Amount", "sum"),
        )
        .reset_index()
    )
    combo = combo.loc[combo["Total_Transactions"] >= 1000].copy()
    combo["Fraud_Rate"] = combo["Fraudulent_Transactions"] / combo["Total_Transactions"]
    combo["Relative_Risk_vs_Overall"] = combo["Fraud_Rate"] / kpis["Fraud Rate"]
    combo = combo.sort_values(["Fraud_Rate", "Fraudulent_Transactions"], ascending=False)

    suspicious = pd.DataFrame([
        pattern_summary(df, df["High_Value_Flag"].eq(1), "Top 1% transaction amount"),
        pattern_summary(df, df["Far_From_Home_Flag"].eq(1), "Top 1% distance from home"),
        pattern_summary(df, df["Off_Hours_Flag"].eq(1), "Off-hours (00:00-05:59)"),
        pattern_summary(df, df["Is_International"].eq(1), "International transaction"),
        pattern_summary(df, df["Authentication_Method"].eq("Neither chip nor PIN"), "Neither chip nor PIN"),
        pattern_summary(df, df["Card_Presence"].eq("Card-Not-Present"), "Card-not-present"),
        pattern_summary(
            df,
            df["High_Value_Flag"].eq(1) & df["Far_From_Home_Flag"].eq(1),
            "Top 1% amount and top 1% distance",
        ),
    ]).sort_values("Fraud_Rate", ascending=False)
    suspicious["Relative_Risk_vs_Overall"] = suspicious["Fraud_Rate"] / kpis["Fraud Rate"]

    tables = {
        "fraud_by_channel": segment_summary(df, "Transaction_Type"),
        "fraud_by_card_presence": segment_summary(df, "Card_Presence"),
        "fraud_by_authentication": segment_summary(df, "Authentication_Method"),
        "fraud_by_category": segment_summary(df, "Merchant_Category"),
        "fraud_by_country": segment_summary(df, "Country"),
        "fraud_by_card_type": segment_summary(df, "Card_Type"),
        "fraud_by_device": segment_summary(df, "Device_Type"),
        "monthly_fraud_trend": monthly,
        "weekly_fraud_trend": weekly,
        "hourly_fraud_trend": hourly,
        "high_risk_segments": combo,
        "suspicious_patterns": suspicious,
        "high_value_fraudulent_transactions": (
            df.loc[fraud].sort_values("Amount", ascending=False).head(100)
        ),
        "dashboard_cube_overall": dashboard_cube(df),
        "dashboard_cube_channel": dashboard_cube(df, "Transaction_Type"),
        "dashboard_cube_card_presence": dashboard_cube(df, "Card_Presence"),
        "dashboard_cube_authentication": dashboard_cube(df, "Authentication_Method"),
        "dashboard_cube_month": dashboard_cube(df, "Month"),
        "dashboard_cube_category": dashboard_cube(df, "Merchant_Category"),
    }
    return tables, kpis


def save_charts(tables: dict[str, pd.DataFrame], kpis: dict[str, object]) -> None:
    sns.set_theme(style="whitegrid", font_scale=0.95)
    plt.rcParams.update({"figure.dpi": 130, "axes.titleweight": "bold", "axes.edgecolor": "#CBD5E0"})

    def finish(filename: str) -> None:
        plt.tight_layout()
        plt.savefig(IMAGE_DIR / filename, bbox_inches="tight", facecolor="white")
        plt.close()

    # Composition.
    counts = [kpis["Legitimate Transactions"], kpis["Fraudulent Transactions"]]
    plt.figure(figsize=(7.2, 4.4))
    wedges, _, _ = plt.pie(
        counts, labels=["Legitimate", "Fraudulent"], autopct="%1.2f%%", startangle=90,
        colors=[PALETTE["blue"], PALETTE["orange"]], pctdistance=0.72,
        wedgeprops={"width": 0.38, "edgecolor": "white"},
    )
    plt.title("Fraudulent vs Legitimate Transactions")
    plt.legend(wedges, [f"Legitimate: {counts[0]:,}", f"Fraudulent: {counts[1]:,}"], loc="lower center", bbox_to_anchor=(0.5, -0.12), ncol=2, frameon=False)
    finish("fraud_vs_legitimate.png")

    chart_specs = [
        ("fraud_by_channel", "Transaction_Type", "Fraud Rate by Transaction Channel", "fraud_rate_by_channel.png"),
        ("fraud_by_card_presence", "Card_Presence", "Fraud Rate by Card Presence", "fraud_rate_by_card_presence.png"),
        ("fraud_by_authentication", "Authentication_Method", "Fraud Rate by Authentication Method", "fraud_rate_by_authentication.png"),
    ]
    for table_name, dimension, title, filename in chart_specs:
        chart_df = tables[table_name].sort_values("Fraud_Rate")
        plt.figure(figsize=(8.4, 4.8))
        ax = sns.barplot(data=chart_df, x="Fraud_Rate", y=dimension, color=PALETTE["blue"])
        ax.xaxis.set_major_formatter(lambda x, pos: f"{x:.2%}")
        ax.set(xlabel="Fraud rate", ylabel="")
        ax.set_title(title)
        for container in ax.containers:
            ax.bar_label(container, labels=[f"{v:.2%}" for v in chart_df["Fraud_Rate"]], padding=4, fontsize=9)
        finish(filename)

    monthly = tables["monthly_fraud_trend"]
    plt.figure(figsize=(11, 5))
    ax = sns.lineplot(data=monthly, x="Month", y="Fraud_Rate", marker="o", color=PALETTE["blue"], linewidth=2)
    ax.yaxis.set_major_formatter(lambda x, pos: f"{x:.2%}")
    ax.set(xlabel="Month", ylabel="Fraud rate", title="Monthly Fraud Rate Trend")
    plt.xticks(rotation=45, ha="right")
    finish("monthly_fraud_trend.png")

    category = tables["fraud_by_category"].sort_values("Fraud_Loss")
    plt.figure(figsize=(9, 5.4))
    ax = sns.barplot(data=category, x="Fraud_Loss", y="Merchant_Category", color=PALETTE["gold"])
    ax.set(xlabel="Fraud loss ($)", ylabel="", title="Fraud Loss by Merchant Category")
    ax.xaxis.set_major_formatter(lambda x, pos: f"${x/1000:.0f}K")
    finish("fraud_loss_by_category.png")

    risk = tables["high_risk_segments"].head(10).copy()
    risk["Segment"] = (
        risk["Transaction_Type"] + " | " + risk["Authentication_Method"] + " | Intl="
        + risk["Is_International"].astype(str) + " | " + risk["Device_Type"]
    )
    risk = risk.sort_values("Fraud_Rate")
    plt.figure(figsize=(10, 6.2))
    ax = sns.barplot(data=risk, x="Fraud_Rate", y="Segment", color=PALETTE["orange"])
    ax.xaxis.set_major_formatter(lambda x, pos: f"{x:.2%}")
    ax.set(xlabel="Fraud rate", ylabel="", title="Top Observed Multi-Dimensional Risk Segments (min. 1,000 transactions)")
    finish("top_high_risk_segments.png")


def main() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)

    cleaned, quality = load_and_clean_data(RAW_FILE)
    tables, kpis = build_analysis_tables(cleaned)

    cleaned.to_csv(PROCESSED_DIR / "cleaned_credit_card_transactions.csv", index=False, date_format="%Y-%m-%d %H:%M:%S")
    quality.to_csv(EXPORT_DIR / "data_quality_report.csv", index=False)
    pd.DataFrame([{"KPI": key, "Value": value} for key, value in kpis.items()]).to_csv(
        EXPORT_DIR / "kpi_summary.csv", index=False
    )
    for filename, table in tables.items():
        table.to_csv(EXPORT_DIR / f"{filename}.csv", index=False)

    with (EXPORT_DIR / "verified_metrics.json").open("w", encoding="utf-8") as file:
        json.dump(kpis, file, indent=2)

    save_charts(tables, kpis)
    print(json.dumps(kpis, indent=2))


if __name__ == "__main__":
    main()
