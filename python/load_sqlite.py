"""Load the cleaned CSV into SQLite for the included SQL analysis."""

from pathlib import Path
import sqlite3

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "processed" / "cleaned_credit_card_transactions.csv"
DB_PATH = ROOT / "data" / "fraud_analytics.db"


def main() -> None:
    if not CSV_PATH.exists():
        raise FileNotFoundError("Run python python/fraud_analysis.py first.")

    selected_columns = [
        "Transaction_ID", "Customer_ID", "Transaction_Date", "Amount",
        "Merchant_Category", "Merchant_ID", "Card_Type", "Transaction_Type",
        "Country", "Is_International", "Is_Chip", "Is_Pin_Used",
        "Distance_From_Home", "Hour_of_Day", "Device_Type", "Fraud_Flag",
        "Card_Presence", "Authentication_Method", "Month", "Week_Start",
        "Day_of_Week", "Fraud_Amount", "High_Value_Flag",
        "Far_From_Home_Flag", "Off_Hours_Flag",
    ]
    with sqlite3.connect(DB_PATH) as connection:
        connection.execute("DROP TABLE IF EXISTS credit_card_transactions")
        first_chunk = True
        for chunk in pd.read_csv(CSV_PATH, usecols=selected_columns, chunksize=50_000):
            chunk.to_sql(
                "credit_card_transactions",
                connection,
                if_exists="replace" if first_chunk else "append",
                index=False,
            )
            first_chunk = False
        connection.executescript(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_id
                ON credit_card_transactions(Transaction_ID);
            CREATE INDEX IF NOT EXISTS idx_fraud_flag
                ON credit_card_transactions(Fraud_Flag);
            CREATE INDEX IF NOT EXISTS idx_month
                ON credit_card_transactions(Month);
            CREATE INDEX IF NOT EXISTS idx_channel
                ON credit_card_transactions(Transaction_Type);
            """
        )
    print(f"SQLite database created: {DB_PATH}")


if __name__ == "__main__":
    main()
