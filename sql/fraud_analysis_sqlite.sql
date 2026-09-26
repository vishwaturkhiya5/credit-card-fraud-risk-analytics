/*
Credit Card Fraud Detection & Financial Risk Analytics
Database: SQLite 3.25+ (window functions required)

Recommended import:
  1. Run: python python/fraud_analysis.py
  2. Run: python python/load_sqlite.py
  3. Open: sqlite3 data/fraud_analytics.db
  4. Execute: .read sql/fraud_analysis_sqlite.sql

All queries use the actual supplied dataset columns plus documented derived
columns created by python/fraud_analysis.py.
*/

-- 1) Optional table definition for a direct/manual CSV import.
DROP TABLE IF EXISTS credit_card_transactions_manual;
CREATE TABLE credit_card_transactions_manual (
    Transaction_ID INTEGER PRIMARY KEY,
    Customer_ID INTEGER NOT NULL,
    Transaction_Date TEXT NOT NULL,
    Amount REAL NOT NULL CHECK (Amount > 0),
    Merchant_Category TEXT NOT NULL,
    Merchant_ID INTEGER NOT NULL,
    Card_Type TEXT NOT NULL,
    Transaction_Type TEXT NOT NULL,
    Country TEXT NOT NULL,
    Is_International INTEGER NOT NULL CHECK (Is_International IN (0, 1)),
    Is_Chip INTEGER NOT NULL CHECK (Is_Chip IN (0, 1)),
    Is_Pin_Used INTEGER NOT NULL CHECK (Is_Pin_Used IN (0, 1)),
    Distance_From_Home REAL NOT NULL CHECK (Distance_From_Home >= 0),
    Hour_of_Day INTEGER NOT NULL CHECK (Hour_of_Day BETWEEN 0 AND 23),
    Device_Type TEXT NOT NULL,
    Fraud_Flag INTEGER NOT NULL CHECK (Fraud_Flag IN (0, 1)),
    Card_Presence TEXT NOT NULL,
    Authentication_Method TEXT NOT NULL,
    Month TEXT NOT NULL,
    Week_Start TEXT NOT NULL,
    Day_of_Week TEXT NOT NULL,
    Fraud_Amount REAL NOT NULL,
    High_Value_Flag INTEGER NOT NULL,
    Far_From_Home_Flag INTEGER NOT NULL,
    Off_Hours_Flag INTEGER NOT NULL
);

-- SQLite shell alternative after creating the table above:
-- .mode csv
-- .import --skip 1 data/processed/cleaned_credit_card_transactions.csv credit_card_transactions_manual


-- 2) Overall KPIs: counts, fraud rate, amount, loss, and average fraud amount.
SELECT
    COUNT(*) AS total_transactions,
    SUM(CASE WHEN Fraud_Flag = 1 THEN 1 ELSE 0 END) AS fraudulent_transactions,
    SUM(CASE WHEN Fraud_Flag = 0 THEN 1 ELSE 0 END) AS legitimate_transactions,
    ROUND(100.0 * AVG(Fraud_Flag), 2) AS fraud_rate_percent,
    ROUND(SUM(Amount), 2) AS total_transaction_amount,
    ROUND(SUM(CASE WHEN Fraud_Flag = 1 THEN Amount ELSE 0 END), 2) AS total_fraud_loss,
    ROUND(AVG(CASE WHEN Fraud_Flag = 1 THEN Amount END), 2) AS average_fraud_amount
FROM credit_card_transactions;


-- 3) Reusable segment pattern: fraud by transaction channel.
SELECT
    Transaction_Type AS channel,
    COUNT(*) AS total_transactions,
    SUM(Fraud_Flag) AS fraudulent_transactions,
    ROUND(100.0 * AVG(Fraud_Flag), 4) AS fraud_rate_percent,
    ROUND(SUM(CASE WHEN Fraud_Flag = 1 THEN Amount ELSE 0 END), 2) AS fraud_loss
FROM credit_card_transactions
GROUP BY Transaction_Type
ORDER BY fraud_rate_percent DESC;


-- 4) Card-present versus card-not-present risk.
-- Definition: Online = card-not-present; POS/ATM = card-present.
SELECT
    CASE WHEN Transaction_Type = 'Online'
         THEN 'Card-Not-Present' ELSE 'Card-Present' END AS card_presence,
    COUNT(*) AS total_transactions,
    SUM(Fraud_Flag) AS fraudulent_transactions,
    ROUND(100.0 * AVG(Fraud_Flag), 4) AS fraud_rate_percent,
    ROUND(SUM(CASE WHEN Fraud_Flag = 1 THEN Amount ELSE 0 END), 2) AS fraud_loss
FROM credit_card_transactions
GROUP BY card_presence
ORDER BY fraud_rate_percent DESC;


-- 5) Authentication-method risk using the actual chip/PIN flags.
SELECT
    CASE
        WHEN Is_Chip = 1 AND Is_Pin_Used = 1 THEN 'Chip + PIN'
        WHEN Is_Chip = 1 AND Is_Pin_Used = 0 THEN 'Chip only'
        WHEN Is_Chip = 0 AND Is_Pin_Used = 1 THEN 'PIN only'
        ELSE 'Neither chip nor PIN'
    END AS authentication_method,
    COUNT(*) AS total_transactions,
    SUM(Fraud_Flag) AS fraudulent_transactions,
    ROUND(100.0 * AVG(Fraud_Flag), 4) AS fraud_rate_percent,
    ROUND(SUM(CASE WHEN Fraud_Flag = 1 THEN Amount ELSE 0 END), 2) AS fraud_loss
FROM credit_card_transactions
GROUP BY authentication_method
ORDER BY fraud_rate_percent DESC;


-- 6) Monthly fraud trend (Month is YYYY-MM and sorts chronologically).
SELECT
    Month,
    COUNT(*) AS total_transactions,
    SUM(Fraud_Flag) AS fraudulent_transactions,
    ROUND(100.0 * AVG(Fraud_Flag), 4) AS fraud_rate_percent,
    ROUND(SUM(CASE WHEN Fraud_Flag = 1 THEN Amount ELSE 0 END), 2) AS fraud_loss
FROM credit_card_transactions
GROUP BY Month
ORDER BY Month;


-- 7) Highest-risk merchant categories with a meaningful volume requirement.
SELECT
    Merchant_Category,
    COUNT(*) AS total_transactions,
    SUM(Fraud_Flag) AS fraudulent_transactions,
    ROUND(100.0 * AVG(Fraud_Flag), 4) AS fraud_rate_percent,
    ROUND(SUM(CASE WHEN Fraud_Flag = 1 THEN Amount ELSE 0 END), 2) AS fraud_loss
FROM credit_card_transactions
GROUP BY Merchant_Category
HAVING COUNT(*) >= 1000
ORDER BY fraud_rate_percent DESC, fraudulent_transactions DESC;


-- 8) Highest-risk individual merchants; HAVING avoids tiny-sample rankings.
WITH merchant_risk AS (
    SELECT
        Merchant_ID,
        COUNT(*) AS total_transactions,
        SUM(Fraud_Flag) AS fraudulent_transactions,
        AVG(Fraud_Flag) AS fraud_rate,
        SUM(CASE WHEN Fraud_Flag = 1 THEN Amount ELSE 0 END) AS fraud_loss
    FROM credit_card_transactions
    GROUP BY Merchant_ID
    HAVING COUNT(*) >= 40
)
SELECT
    Merchant_ID,
    total_transactions,
    fraudulent_transactions,
    ROUND(100.0 * fraud_rate, 4) AS fraud_rate_percent,
    ROUND(fraud_loss, 2) AS fraud_loss
FROM merchant_risk
ORDER BY fraud_rate DESC, total_transactions DESC
LIMIT 25;


-- 9) High-value fraudulent transactions: top 1% by amount, derived dynamically.
WITH ranked_transactions AS (
    SELECT
        Transaction_ID, Transaction_Date, Customer_ID, Merchant_ID,
        Merchant_Category, Transaction_Type, Country, Amount, Fraud_Flag,
        NTILE(100) OVER (ORDER BY Amount DESC) AS amount_percentile_bucket
    FROM credit_card_transactions
)
SELECT *
FROM ranked_transactions
WHERE Fraud_Flag = 1 AND amount_percentile_bucket = 1
ORDER BY Amount DESC;


-- 10) Rank countries by fraud rate and fraud loss with window functions.
WITH country_metrics AS (
    SELECT
        Country,
        COUNT(*) AS total_transactions,
        SUM(Fraud_Flag) AS fraudulent_transactions,
        AVG(Fraud_Flag) AS fraud_rate,
        SUM(CASE WHEN Fraud_Flag = 1 THEN Amount ELSE 0 END) AS fraud_loss
    FROM credit_card_transactions
    GROUP BY Country
)
SELECT
    Country,
    total_transactions,
    fraudulent_transactions,
    ROUND(100.0 * fraud_rate, 4) AS fraud_rate_percent,
    ROUND(fraud_loss, 2) AS fraud_loss,
    DENSE_RANK() OVER (ORDER BY fraud_rate DESC) AS fraud_rate_rank,
    DENSE_RANK() OVER (ORDER BY fraud_loss DESC) AS fraud_loss_rank
FROM country_metrics
ORDER BY fraud_rate_rank;


-- 11) Multi-dimensional high-risk segments and relative risk vs overall.
WITH overall AS (
    SELECT AVG(Fraud_Flag) AS overall_fraud_rate
    FROM credit_card_transactions
), segment_metrics AS (
    SELECT
        Transaction_Type,
        Authentication_Method,
        Is_International,
        Device_Type,
        COUNT(*) AS total_transactions,
        SUM(Fraud_Flag) AS fraudulent_transactions,
        AVG(Fraud_Flag) AS fraud_rate,
        SUM(Fraud_Amount) AS fraud_loss
    FROM credit_card_transactions
    GROUP BY Transaction_Type, Authentication_Method, Is_International, Device_Type
    HAVING COUNT(*) >= 1000
)
SELECT
    s.*,
    ROUND(100.0 * s.fraud_rate, 4) AS fraud_rate_percent,
    ROUND(s.fraud_rate / o.overall_fraud_rate, 3) AS relative_risk_vs_overall,
    DENSE_RANK() OVER (ORDER BY s.fraud_rate DESC) AS segment_risk_rank
FROM segment_metrics s
CROSS JOIN overall o
ORDER BY segment_risk_rank, total_transactions DESC;


-- 12) Suspicious-pattern flags: compare each flag with the overall baseline.
WITH overall AS (
    SELECT AVG(Fraud_Flag) AS overall_fraud_rate FROM credit_card_transactions
), patterns AS (
    SELECT 'High value (top 1%)' AS pattern, High_Value_Flag AS is_match, Fraud_Flag, Fraud_Amount
    FROM credit_card_transactions
    UNION ALL
    SELECT 'Far from home (top 1%)', Far_From_Home_Flag, Fraud_Flag, Fraud_Amount
    FROM credit_card_transactions
    UNION ALL
    SELECT 'Off-hours (00:00-05:59)', Off_Hours_Flag, Fraud_Flag, Fraud_Amount
    FROM credit_card_transactions
    UNION ALL
    SELECT 'International', Is_International, Fraud_Flag, Fraud_Amount
    FROM credit_card_transactions
)
SELECT
    p.pattern,
    COUNT(*) AS total_transactions,
    SUM(p.Fraud_Flag) AS fraudulent_transactions,
    ROUND(100.0 * AVG(p.Fraud_Flag), 4) AS fraud_rate_percent,
    ROUND(AVG(p.Fraud_Flag) / o.overall_fraud_rate, 3) AS relative_risk_vs_overall,
    ROUND(SUM(p.Fraud_Amount), 2) AS fraud_loss
FROM patterns p
CROSS JOIN overall o
WHERE p.is_match = 1
GROUP BY p.pattern
ORDER BY relative_risk_vs_overall DESC;


-- 13) Customer subquery: customers with repeated fraud observations.
SELECT *
FROM (
    SELECT
        Customer_ID,
        COUNT(*) AS total_transactions,
        SUM(Fraud_Flag) AS fraudulent_transactions,
        ROUND(SUM(Fraud_Amount), 2) AS fraud_loss
    FROM credit_card_transactions
    GROUP BY Customer_ID
)
WHERE fraudulent_transactions >= 2
ORDER BY fraudulent_transactions DESC, fraud_loss DESC
LIMIT 50;
