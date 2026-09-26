import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const root = process.env.FRAUD_PROJECT_ROOT;
if (!root) throw new Error("FRAUD_PROJECT_ROOT is required");

const rawPath = path.join(root, "data/raw/credit_card_fraud_2025.csv");
const cleanedPath = path.join(root, "data/processed/cleaned_credit_card_transactions.csv");
const exportsDir = path.join(root, "data/exports");
const outputPath = path.join(root, "excel_dashboard/Credit_Card_Fraud_Risk_Dashboard.xlsx");
const previewDir = path.join(root, "excel_dashboard/previews");
const EXCEL_DETAIL_ROWS = 10000;

const COLORS = {
  navy: "#102A43", blue: "#2F6B9A", gold: "#D9A441", orange: "#D97706",
  paleBlue: "#EAF2F8", paleGold: "#FBF3DF", white: "#FFFFFF",
  ink: "#243B53", muted: "#627D98", line: "#D9E2EC", bg: "#F5F7FA",
};

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ""; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

async function readCsv(name) {
  return parseCsv(await fs.readFile(path.join(exportsDir, name), "utf8"));
}

function typeCube(rows) {
  return rows.map((row, index) => index === 0 ? row : row.map((value, column) => {
    if (column >= row.length - 4) return Number(value);
    return value;
  }));
}

function styleTitle(sheet, rangeAddress, text) {
  const range = sheet.getRange(rangeAddress);
  range.merge();
  range.values = [[text]];
  range.format = {
    fill: COLORS.navy,
    font: { bold: true, color: COLORS.white, size: 18 },
    verticalAlignment: "center",
    horizontalAlignment: "left",
  };
  range.format.rowHeight = 38;
}

function styleHeader(range) {
  range.format = {
    fill: COLORS.blue,
    font: { bold: true, color: COLORS.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: COLORS.navy },
  };
  range.format.rowHeight = 30;
}

function styleCard(sheet, labelRange, valueRange, label, formula, numberFormat, accent) {
  const labelBlock = sheet.getRange(labelRange);
  labelBlock.merge();
  labelBlock.values = [[label]];
  labelBlock.format = {
    fill: accent,
    font: { bold: true, color: COLORS.white, size: 10 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "medium", color: accent },
  };
  const valueBlock = sheet.getRange(valueRange);
  valueBlock.merge();
  valueBlock.getCell(0, 0).formulas = [[formula]];
  valueBlock.format = {
    fill: COLORS.white,
    font: { bold: true, color: COLORS.ink, size: 19 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    numberFormat,
    borders: { preset: "outside", style: "medium", color: accent },
  };
}

function criteriaFormula(sumColumn, startRow, endRow, dims, breakdownColumn = null, breakdownCell = null) {
  const base = `'Pivot_Analysis'!$${sumColumn}$${startRow}:$${sumColumn}$${endRow}`;
  const pairs = [
    [`'Pivot_Analysis'!$${dims.country}$${startRow}:$${dims.country}$${endRow}`, `IF('Dashboard'!$B$3="All","<>",'Dashboard'!$B$3)`],
    [`'Pivot_Analysis'!$${dims.card}$${startRow}:$${dims.card}$${endRow}`, `IF('Dashboard'!$E$3="All","<>",'Dashboard'!$E$3)`],
    [`'Pivot_Analysis'!$${dims.device}$${startRow}:$${dims.device}$${endRow}`, `IF('Dashboard'!$H$3="All","<>",'Dashboard'!$H$3)`],
  ];
  if (breakdownColumn && breakdownCell) {
    pairs.push([`'Pivot_Analysis'!$${breakdownColumn}$${startRow}:$${breakdownColumn}$${endRow}`, breakdownCell]);
  }
  return `=SUMIFS(${base},${pairs.flat().join(",")})`;
}

function addCube(sheet, startCell, rows, tableName) {
  const match = /^([A-Z]+)(\d+)$/.exec(startCell);
  const startRow = Number(match[2]);
  const startColLetters = match[1];
  const startCol = [...startColLetters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rowCount = rows.length;
  const colCount = rows[0].length;
  const range = sheet.getRangeByIndexes(startRow - 1, startCol, rowCount, colCount);
  range.values = rows;
  styleHeader(sheet.getRangeByIndexes(startRow - 1, startCol, 1, colCount));
  const table = sheet.tables.add(range, true, tableName);
  table.style = "TableStyleMedium2";
  return { startRow: startRow + 1, endRow: startRow + rowCount - 1 };
}

await fs.mkdir(previewDir, { recursive: true });
const rawCsvFull = await fs.readFile(rawPath, "utf8");
const cleanedCsvFull = await fs.readFile(cleanedPath, "utf8");
const rawCsv = rawCsvFull.split(/\r?\n/).slice(0, EXCEL_DETAIL_ROWS + 1).join("\n");
const cleanedCsv = cleanedCsvFull.split(/\r?\n/).slice(0, EXCEL_DETAIL_ROWS + 1).join("\n");

const workbook = await Workbook.fromCSV(rawCsv, { sheetName: "Raw_Data" });
await workbook.fromCSV(cleanedCsv, { sheetName: "Cleaned_Data" });
const raw = workbook.worksheets.getItem("Raw_Data");
const cleaned = workbook.worksheets.getItem("Cleaned_Data");
const kpi = workbook.worksheets.add("KPI_Summary");
const pivot = workbook.worksheets.add("Pivot_Analysis");
const dashboard = workbook.worksheets.add("Dashboard");
const dictionary = workbook.worksheets.add("Data_Dictionary");

// Raw and cleaned data usability.
for (const sheet of [raw, cleaned]) {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
}
styleHeader(raw.getRange("A1:P1"));
styleHeader(cleaned.getRange("A1:Y1"));
raw.tables.add("A1:P10001", true, "RawTransactionsTable").style = "TableStyleMedium2";
cleaned.tables.add("A1:Y10001", true, "CleanedTransactionsTable").style = "TableStyleMedium2";
raw.getRange("D2:D10001").format.numberFormat = "$#,##0.00";
cleaned.getRange("D2:D10001").format.numberFormat = "$#,##0.00";
cleaned.getRange("V2:V10001").format.numberFormat = "$#,##0.00";
cleaned.getRange("P2:P10001").conditionalFormats.add("cellIs", {
  operator: "equal", formula: 1, format: { fill: "#FDE8E3", font: { bold: true, color: COLORS.orange } },
});
for (const sheet of [raw, cleaned]) {
  sheet.getRange("A1:A10001").format.columnWidth = 14;
  sheet.getRange("B1:B10001").format.columnWidth = 14;
  sheet.getRange("C1:C10001").format.columnWidth = 20;
  sheet.getRange("D1:D10001").format.columnWidth = 14;
  sheet.getRange("E1:E10001").format.columnWidth = 20;
  sheet.getRange("F1:P10001").format.columnWidth = 15;
}
cleaned.getRange("Q1:Y10001").format.columnWidth = 19;

// Compact dashboard cubes.
pivot.showGridLines = false;
styleTitle(pivot, "A1:Q1", "Pivot Analysis & Dashboard Data Model");
pivot.getRange("A2:Q2").merge();
pivot.getRange("A2").values = [["Filter-responsive analysis tables are driven by compact Country × Card Type × Device cubes below."]];
pivot.getRange("A2:Q2").format = { fill: COLORS.paleBlue, font: { italic: true, color: COLORS.muted }, wrapText: true };

const overallRows = typeCube(await readCsv("dashboard_cube_overall.csv"));
const channelRows = typeCube(await readCsv("dashboard_cube_channel.csv"));
const presenceRows = typeCube(await readCsv("dashboard_cube_card_presence.csv"));
const authRows = typeCube(await readCsv("dashboard_cube_authentication.csv"));
const monthRows = typeCube(await readCsv("dashboard_cube_month.csv"));
const categoryRows = typeCube(await readCsv("dashboard_cube_category.csv"));

const cubeOverall = addCube(pivot, "A36", overallRows, "CubeOverall");
const cubeChannel = addCube(pivot, "I36", channelRows, "CubeChannel");
const cubePresence = addCube(pivot, "R36", presenceRows, "CubePresence");
const cubeAuth = addCube(pivot, "AA36", authRows, "CubeAuthentication");
const cubeMonth = addCube(pivot, "AJ36", monthRows, "CubeMonth");
const cubeCategory = addCube(pivot, "AS36", categoryRows, "CubeCategory");

// Dashboard filters are created before formulas that reference them.
dashboard.showGridLines = false;
styleTitle(dashboard, "A1:R1", "Credit Card Fraud Detection & Financial Risk Dashboard");
dashboard.getRange("A2:R2").merge();
dashboard.getRange("A2").values = [["KPIs use all 500,000 source transactions | Excel detail tabs show first 10,000 rows; full data remains in CSV | Currency displayed as $ by assumption"]];
dashboard.getRange("A2:R2").format = { fill: COLORS.paleBlue, font: { color: COLORS.muted, size: 9 }, horizontalAlignment: "center" };
dashboard.getRange("A3").values = [["Country"]]; dashboard.getRange("B3").values = [["All"]];
dashboard.getRange("D3").values = [["Card Type"]]; dashboard.getRange("E3").values = [["All"]];
dashboard.getRange("G3").values = [["Device"]]; dashboard.getRange("H3").values = [["All"]];
dashboard.getRange("J3:R3").merge(); dashboard.getRange("J3").values = [["Use dropdowns to update every KPI and chart"]];
dashboard.getRange("A3:R3").format = { fill: COLORS.paleGold, font: { bold: true, color: COLORS.ink }, verticalAlignment: "center" };
dashboard.getRange("B3").dataValidation = { rule: { type: "list", values: ["All", "Australia", "Canada", "France", "Germany", "India", "Singapore", "UK", "USA"] } };
dashboard.getRange("E3").dataValidation = { rule: { type: "list", values: ["All", "Credit", "Debit", "Gold", "Platinum"] } };
dashboard.getRange("H3").dataValidation = { rule: { type: "list", values: ["All", "Mobile", "Terminal", "Web"] } };

const overallDims = { country: "A", card: "B", device: "C" };
const totalFormula = criteriaFormula("D", cubeOverall.startRow, cubeOverall.endRow, overallDims);
const fraudFormula = criteriaFormula("E", cubeOverall.startRow, cubeOverall.endRow, overallDims);
const amountFormula = criteriaFormula("F", cubeOverall.startRow, cubeOverall.endRow, overallDims);
const lossFormula = criteriaFormula("G", cubeOverall.startRow, cubeOverall.endRow, overallDims);
styleCard(dashboard, "A5:C5", "A6:C8", "TOTAL TRANSACTIONS", totalFormula, "#,##0", COLORS.blue);
styleCard(dashboard, "D5:F5", "D6:F8", "TOTAL TRANSACTION AMOUNT", amountFormula, "$#,##0", COLORS.navy);
styleCard(dashboard, "G5:I5", "G6:I8", "FRAUDULENT TRANSACTIONS", fraudFormula, "#,##0", COLORS.orange);
styleCard(dashboard, "J5:L5", "J6:L8", "FRAUD RATE", "=IFERROR(G6/A6,0)", "0.00%", COLORS.gold);
styleCard(dashboard, "M5:O5", "M6:O8", "TOTAL FRAUD LOSS", lossFormula, "$#,##0", COLORS.orange);
styleCard(dashboard, "P5:R5", "P6:R8", "AVERAGE FRAUD AMOUNT", "=IFERROR(M6/G6,0)", "$#,##0.00", COLORS.blue);

// Filter-responsive analysis tables.
function writeAnalysisTable(startRow, startCol, headers, categories, cube, dims, breakdownCol, valueCols) {
  const range = pivot.getRangeByIndexes(startRow - 1, startCol - 1, categories.length + 1, headers.length);
  range.getRow(0).values = [headers];
  styleHeader(range.getRow(0));
  categories.forEach((category, idx) => {
    const row = startRow + idx + 1;
    pivot.getCell(row - 1, startCol - 1).values = [[category]];
    pivot.getCell(row - 1, startCol).formulas = [[criteriaFormula(valueCols.total, cube.startRow, cube.endRow, dims, breakdownCol, `'Pivot_Analysis'!${String.fromCharCode(64 + startCol)}${row}`)]];
    pivot.getCell(row - 1, startCol + 1).formulas = [[criteriaFormula(valueCols.fraud, cube.startRow, cube.endRow, dims, breakdownCol, `'Pivot_Analysis'!${String.fromCharCode(64 + startCol)}${row}`)]];
    pivot.getCell(row - 1, startCol + 2).formulas = [[`=IFERROR(${String.fromCharCode(66 + startCol)}${row}/${String.fromCharCode(65 + startCol)}${row},0)`]];
    pivot.getCell(row - 1, startCol + 3).formulas = [[criteriaFormula(valueCols.loss, cube.startRow, cube.endRow, dims, breakdownCol, `'Pivot_Analysis'!${String.fromCharCode(64 + startCol)}${row}`)]];
  });
  range.getColumn(3).format.numberFormat = "0.00%";
  range.getColumn(4).format.numberFormat = "$#,##0";
  range.format.borders = { preset: "outside", style: "thin", color: COLORS.line };
  return range;
}

writeAnalysisTable(4, 1, ["Channel", "Transactions", "Fraud Txns", "Fraud Rate", "Fraud Loss"], ["ATM", "Online", "POS"], cubeChannel, {country:"I",card:"J",device:"K"}, "L", {total:"M",fraud:"N",loss:"P"});
writeAnalysisTable(4, 7, ["Card Presence", "Transactions", "Fraud Txns", "Fraud Rate", "Fraud Loss"], ["Card-Not-Present", "Card-Present"], cubePresence, {country:"R",card:"S",device:"T"}, "U", {total:"V",fraud:"W",loss:"Y"});
writeAnalysisTable(4, 13, ["Authentication", "Transactions", "Fraud Txns", "Fraud Rate", "Fraud Loss"], ["Chip + PIN", "Chip only", "PIN only", "Neither chip nor PIN"], cubeAuth, {country:"AA",card:"AB",device:"AC"}, "AD", {total:"AE",fraud:"AF",loss:"AH"});

const months = (await readCsv("monthly_fraud_trend.csv")).slice(1).map(r => r[0]);
writeAnalysisTable(11, 1, ["Month", "Transactions", "Fraud Txns", "Fraud Rate", "Fraud Loss"], months, cubeMonth, {country:"AJ",card:"AK",device:"AL"}, "AM", {total:"AN",fraud:"AO",loss:"AQ"});
const categories = (await readCsv("fraud_by_category.csv")).slice(1).map(r => r[0]).sort();
writeAnalysisTable(11, 7, ["Category", "Transactions", "Fraud Txns", "Fraud Rate", "Fraud Loss"], categories, cubeCategory, {country:"AS",card:"AT",device:"AU"}, "AV", {total:"AW",fraud:"AX",loss:"AZ"});

// Stable-volume segment ranking (overall; descriptive).
const riskRows = await readCsv("high_risk_segments.csv");
pivot.getRange("M11:Q11").values = [["Top Risk Segment (overall)", "Transactions", "Fraud Txns", "Fraud Rate", "Relative Risk"]];
styleHeader(pivot.getRange("M11:Q11"));
for (let i = 1; i <= Math.min(10, riskRows.length - 1); i++) {
  const r = riskRows[i];
  const label = `${r[0]} | ${r[1]} | Intl=${r[2]} | ${r[3]}`;
  pivot.getRange(`M${11+i}:Q${11+i}`).values = [[label, Number(r[4]), Number(r[5]), Number(r[7]), Number(r[8])]];
}
pivot.getRange("P12:Q21").format.numberFormat = "0.00%";
pivot.getRange("A4:Q32").format.borders = { preset: "outside", style: "thin", color: COLORS.line };
pivot.freezePanes.freezeRows(3);
pivot.getRange("A1:Q2200").format.columnWidth = 16;
pivot.getRange("A1:A2200").format.columnWidth = 20;
pivot.getRange("G1:G2200").format.columnWidth = 22;
pivot.getRange("M1:M2200").format.columnWidth = 48;

// KPI summary formulas and definitions.
kpi.showGridLines = false;
styleTitle(kpi, "A1:F1", "Verified KPI Summary");
kpi.getRange("A3:F3").values = [["KPI", "Formula / Definition", "Verified Value", "Resume Claim", "Status", "Notes"]];
styleHeader(kpi.getRange("A3:F3"));
const kpiRows = [
  ["Total Transactions", "Count of unique transaction rows", "=SUM('Pivot_Analysis'!D37:D132)", "500K+", "Verified with wording update", "Exactly 500,000; use the precise count"],
  ["Fraudulent Transactions", "Sum of Fraud_Flag", "=SUM('Pivot_Analysis'!E37:E132)", "Not stated", "Verified", "7,500 fraud-labeled rows"],
  ["Legitimate Transactions", "Total minus fraudulent", "=C4-C5", "Not stated", "Verified", "492,500 legitimate rows"],
  ["Fraud Rate", "Fraudulent / total", "=C5/C4", "1.50%", "Verified", "Exact rate is 1.50%"],
  ["Total Transaction Amount", "Sum of Amount", "=SUM('Pivot_Analysis'!F37:F132)", "Not stated", "Verified", "Currency metadata is unavailable"],
  ["Total Fraud Loss", "Sum of Amount where Fraud_Flag=1", "=SUM('Pivot_Analysis'!G37:G132)", "$1.09M", "Verified (rounded)", "Exact: $1,088,218.66"],
  ["Average Fraud Amount", "Fraud loss / fraudulent", "=C9/C5", "Not stated", "Verified", "Average fraud-labeled amount"],
];
kpi.getRange("A4:F10").values = kpiRows.map(row => row.map((v, i) => i === 2 && typeof v === "string" && v.startsWith("=") ? null : v));
kpiRows.forEach((row, idx) => { kpi.getCell(3 + idx, 2).formulas = [[row[2]]]; });
kpi.getRange("C4:C6").format.numberFormat = "#,##0";
kpi.getRange("C7").format.numberFormat = "0.00%";
kpi.getRange("C8:C10").format.numberFormat = "$#,##0.00";
kpi.getRange("E4:E10").conditionalFormats.add("containsText", { text: "Verified", format: { fill: "#E6F4EA", font: { bold: true, color: "#286E3C" } } });
kpi.getRange("A3:F10").format.borders = { preset: "outside", style: "thin", color: COLORS.line };
kpi.getRange("A1:F10").format.columnWidth = 23;
kpi.getRange("B1:B10").format.columnWidth = 32;
kpi.getRange("F1:F10").format.columnWidth = 36;
kpi.getRange("A3:F10").format.wrapText = true;
kpi.freezePanes.freezeRows(3);

// Dashboard helper ranges outside the visible canvas.
dashboard.getRange("T2:U4").values = [["Status", "Transactions"], ["Fraudulent", null], ["Legitimate", null]];
dashboard.getRange("U3").formulas = [["=G6"]]; dashboard.getRange("U4").formulas = [["=A6-G6"]];
dashboard.getRange("T6:U9").values = [["Channel", "Fraud Rate"], ["ATM", null], ["Online", null], ["POS", null]];
dashboard.getRange("U7:U9").formulas = [["='Pivot_Analysis'!D5"], ["='Pivot_Analysis'!D6"], ["='Pivot_Analysis'!D7"]];
dashboard.getRange("W6:X8").values = [["Card Presence", "Fraud Rate"], ["Card-Not-Present", null], ["Card-Present", null]];
dashboard.getRange("X7:X8").formulas = [["='Pivot_Analysis'!J5"], ["='Pivot_Analysis'!J6"]];
dashboard.getRange("Z6:AA10").values = [["Authentication", "Fraud Rate"], ["Chip + PIN", null], ["Chip only", null], ["PIN only", null], ["Neither chip nor PIN", null]];
dashboard.getRange("AA7:AA10").formulas = [["='Pivot_Analysis'!P5"], ["='Pivot_Analysis'!P6"], ["='Pivot_Analysis'!P7"], ["='Pivot_Analysis'!P8"]];
dashboard.getRange("AC6:AD27").values = [["Month", "Fraud Rate"], ...months.map(m => [m, null])];
for (let i = 0; i < months.length; i++) dashboard.getCell(6 + i, 29).formulas = [[`='Pivot_Analysis'!D${12+i}`]];
const displayCategories = categories.map(c => c === "Entertainment" ? "Entertain." : c === "Online Services" ? "Online Svcs" : c);
dashboard.getRange("AF6:AG16").values = [["Category", "Fraud Loss"], ...displayCategories.map(c => [c, null])];
for (let i = 0; i < categories.length; i++) dashboard.getCell(6 + i, 32).formulas = [[`='Pivot_Analysis'!K${12+i}`]];

function addChart(type, source, title, start, end, yFormat, legend = false) {
  const chart = dashboard.charts.add(type, dashboard.getRange(source));
  chart.title = title;
  chart.titleTextStyle.fontSize = 12;
  chart.hasLegend = legend;
  chart.setPosition(start, end);
  if (yFormat) chart.yAxis = { numberFormatCode: yFormat, min: 0, textStyle: { fontSize: 8 } };
  chart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 8 } };
  return chart;
}
addChart("doughnut", "T2:U4", "Fraudulent vs Legitimate Transactions", "A11", "F24", null, true);
addChart("bar", "T6:U9", "Fraud Rate by Transaction Channel", "G11", "L24", "0.00%", false);
addChart("bar", "W6:X8", "Card-Present vs Card-Not-Present Risk", "M11", "R24", "0.00%", false);
addChart("bar", "Z6:AA10", "Fraud Rate by Authentication Method", "A26", "F40", "0.00%", false);
addChart("line", "AC6:AD27", "Monthly Fraud Rate Trend", "G26", "L40", "0.00%", false);
addChart("bar", "AF6:AG16", "Fraud Loss by Merchant Category", "M26", "R40", "$#,##0", false);

dashboard.getRange("A42:R42").merge();
dashboard.getRange("A42").values = [["Top Observed High-Risk Segments (minimum 1,000 transactions; overall ranking)"]];
dashboard.getRange("A42:R42").format = { fill: COLORS.navy, font: { bold: true, color: COLORS.white, size: 11 }, horizontalAlignment: "left" };
dashboard.getRange("A43:R43").values = [["Segment", "", "", "", "", "", "", "", "", "Transactions", "", "Fraud Txns", "", "Fraud Rate", "", "Relative Risk", "", ""]];
dashboard.getRange("A43:I43").merge(); dashboard.getRange("J43:K43").merge(); dashboard.getRange("L43:M43").merge(); dashboard.getRange("N43:O43").merge(); dashboard.getRange("P43:R43").merge();
styleHeader(dashboard.getRange("A43:R43"));
for (let i = 0; i < 10; i++) {
  const row = 44 + i;
  dashboard.getRange(`A${row}:I${row}`).merge(); dashboard.getRange(`A${row}`).formulas = [[`='Pivot_Analysis'!M${12+i}`]];
  dashboard.getRange(`J${row}:K${row}`).merge(); dashboard.getRange(`J${row}`).formulas = [[`='Pivot_Analysis'!N${12+i}`]];
  dashboard.getRange(`L${row}:M${row}`).merge(); dashboard.getRange(`L${row}`).formulas = [[`='Pivot_Analysis'!O${12+i}`]];
  dashboard.getRange(`N${row}:O${row}`).merge(); dashboard.getRange(`N${row}`).formulas = [[`='Pivot_Analysis'!P${12+i}`]];
  dashboard.getRange(`P${row}:R${row}`).merge(); dashboard.getRange(`P${row}`).formulas = [[`='Pivot_Analysis'!Q${12+i}`]];
}
dashboard.getRange("N44:R53").format.numberFormat = "0.00%";
dashboard.getRange("A43:R53").format.borders = { preset: "all", style: "thin", color: COLORS.line };
dashboard.getRange("A55:R55").merge();
dashboard.getRange("A55").values = [["Interpretation note: segment rankings are descriptive. Small rate differences and multiple comparisons do not prove causality or control effectiveness."]];
dashboard.getRange("A55:R55").format = { fill: COLORS.paleGold, font: { italic: true, color: COLORS.muted, size: 9 }, wrapText: true };
dashboard.freezePanes.freezeRows(3);
dashboard.getRange("A1:R55").format.columnWidth = 9.5;
dashboard.getRange("A1:A55").format.columnWidth = 12;

// Data dictionary and assumptions.
dictionary.showGridLines = false;
styleTitle(dictionary, "A1:F1", "Data Dictionary, KPI Definitions & Assumptions");
dictionary.getRange("A3:F3").values = [["Column", "Type", "Source", "Definition", "Cleaning / Derivation", "Analytical Note"]];
styleHeader(dictionary.getRange("A3:F3"));
const dictionaryRows = [
  ["Transaction_ID","Integer","Original","Unique transaction identifier","Numeric; uniqueness validated","Dataset grain"],
  ["Customer_ID","Integer","Original","Customer identifier","Numeric","Potential repeated-customer analysis"],
  ["Transaction_Date","Datetime","Original","Transaction timestamp","Parsed as DD-MM-YYYY HH:MM","Coverage: Jan 2024–Sep 2025"],
  ["Amount","Decimal","Original","Transaction amount","Numeric; must be > 0","Currency not supplied; shown as $ by assumption"],
  ["Merchant_Category","Text","Original","Merchant industry/category","Whitespace trimmed","Used for loss and rate comparisons"],
  ["Merchant_ID","Integer","Original","Merchant identifier","Numeric","Use volume thresholds when ranking"],
  ["Card_Type","Text","Original","Card tier/type","Whitespace trimmed","Dashboard filter"],
  ["Transaction_Type","Text","Original","ATM, Online, or POS channel","Whitespace trimmed","Used as transaction channel"],
  ["Country","Text","Original","Transaction country","Whitespace trimmed","Dashboard filter; not necessarily merchant domicile"],
  ["Is_International","Binary","Original","1 if international","Validated in {0,1}","Descriptive flag"],
  ["Is_Chip","Binary","Original","1 if chip was used","Validated in {0,1}","Authentication derivation"],
  ["Is_Pin_Used","Binary","Original","1 if PIN was used","Validated in {0,1}","Authentication derivation"],
  ["Distance_From_Home","Decimal","Original","Distance from customer home","Must be non-negative","Unit not supplied"],
  ["Hour_of_Day","Integer","Original","Hour 0–23","Validated against timestamp","Hourly trend"],
  ["Device_Type","Text","Original","Mobile, Terminal, or Web","Whitespace trimmed","Dashboard filter"],
  ["Fraud_Flag","Binary","Original","1 fraudulent; 0 legitimate","Validated in {0,1}","Treated as supplied ground truth"],
  ["Card_Presence","Text","Derived","Online=CNP; POS/ATM=CP","CASE definition","Assumption, not source field"],
  ["Authentication_Method","Text","Derived","Chip + PIN / Chip only / PIN only / Neither","From chip and PIN flags","Not a source field"],
  ["Month","Text","Derived","YYYY-MM transaction month","From parsed timestamp","Chronological helper"],
  ["Week_Start","Date","Derived","Monday of transaction week","From parsed timestamp","Weekly helper"],
  ["Day_of_Week","Text","Derived","Named weekday","From parsed timestamp","Temporal helper"],
  ["Fraud_Amount","Decimal","Derived","Amount when fraud, otherwise 0","CASE on Fraud_Flag","Fraud loss numerator"],
  ["High_Value_Flag","Binary","Derived","Amount at/above 99th percentile","Threshold $579.53","Descriptive suspicious-pattern flag"],
  ["Far_From_Home_Flag","Binary","Derived","Distance at/above 99th percentile","Threshold 23.01","Distance unit unavailable"],
  ["Off_Hours_Flag","Binary","Derived","Hour between 00:00 and 05:59","From Hour_of_Day","Descriptive suspicious-pattern flag"],
];
dictionary.getRange(`A4:F${3 + dictionaryRows.length}`).values = dictionaryRows;
dictionary.getRange("A30:F30").merge();
dictionary.getRange("A30").values = [["Workbook size note: Raw_Data and Cleaned_Data contain the first 10,000 rows for responsive Excel use. All KPIs, charts, SQL, and exported analysis tables use the complete 500,000-row dataset; full raw and cleaned CSV files are included in the project."]];
dictionary.getRange("A30:F30").format = { fill: COLORS.paleGold, font: { italic: true, color: COLORS.muted }, wrapText: true };
dictionary.getRange(`A3:F${3 + dictionaryRows.length}`).format.borders = { preset: "outside", style: "thin", color: COLORS.line };
dictionary.getRange(`A4:F${3 + dictionaryRows.length}`).format.wrapText = true;
dictionary.getRange("A1:F30").format.columnWidth = 22;
dictionary.getRange("D1:F30").format.columnWidth = 36;
dictionary.freezePanes.freezeRows(3);

// Compact verification and previews.
const inspection = await workbook.inspect({ kind: "table", range: "Dashboard!A1:R55", include: "values,formulas", tableMaxRows: 16, tableMaxCols: 18, maxChars: 9000 });
console.log(inspection.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });
console.log(errors.ndjson);

const previewSpecs = [
  ["Dashboard", "A1:R55", "dashboard_preview.png"],
  ["KPI_Summary", "A1:F12", "kpi_summary_preview.png"],
  ["Pivot_Analysis", "A1:Q32", "pivot_analysis_preview.png"],
  ["Data_Dictionary", "A1:F30", "data_dictionary_preview.png"],
  ["Raw_Data", "A1:P18", "raw_data_preview.png"],
  ["Cleaned_Data", "A1:Y18", "cleaned_data_preview.png"],
];
if (process.env.FRAUD_SKIP_PREVIEWS !== "1") {
  for (const [sheetName, range, filename] of previewSpecs) {
    const blob = await workbook.render({ sheetName, range, scale: 1, format: "png" });
    await fs.writeFile(path.join(previewDir, filename), new Uint8Array(await blob.arrayBuffer()));
  }
}
await fs.copyFile(path.join(previewDir, "dashboard_preview.png"), path.join(root, "images/dashboard_preview.png"));

try {
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  console.log(`Saved ${outputPath}`);
} catch (error) {
  console.error(`EXPORT_ERROR: ${error?.message ?? String(error)}`);
  process.exitCode = 1;
}
