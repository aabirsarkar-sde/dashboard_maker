const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDelimited, extractTables, datasetProfile, parseDate, cellText, aggregate, metricTotal, isTotalRow, normalizeSheetDates } = require('../parser.js');

function load(fixture) {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8');
  const tables = extractTables(parseDelimited(text, ','), 'Sheet');
  return datasetProfile(tables[0], 'Sheet', 0, fixture);
}
const months = (dataset, metric) => aggregate(dataset.rows, dataset.dateColumn, metric, dataset).map((group) => [group.key, group.value]);

test('finds the header below title rows', () => {
  assert.deepEqual(load('sales-with-totals.csv').columns, ['Category', 'Region', 'Revenue', 'Profit']);
});

test('total and subtotal rows are not counted as data', () => {
  const dataset = load('sales-with-totals.csv');
  assert.equal(metricTotal(dataset.rows, 'Revenue', dataset.columns), 600);
  assert.equal(dataset.excludedTotalRows, 2);
});

test('a bare Total row is excluded but a customer named Total Wine is kept', () => {
  const dataset = load('label-then-total.csv');
  assert.deepEqual(dataset.rows.map((row) => row.Customer), ['Acme', 'Total Wine']);
});

for (const label of ['Total', 'TOTAL', 'Totals', 'Grand Total', 'Subtotal', 'Sub-total', 'West Total']) {
  test(`"${label}" is a total label`, () => assert.equal(isTotalRow(label), true));
}
for (const label of ['Total Wine', 'Totally Fresh', 'Acme', '']) {
  test(`"${label}" is not a total label`, () => assert.equal(isTotalRow(label), false));
}

test('total rows in wide period tables are skipped when reshaping', () => {
  const dataset = load('wide-periods.csv');
  assert.equal(metricTotal(dataset.rows, dataset.metrics[0], dataset.columns), 210);
  assert.equal(dataset.excludedTotalRows, 1);
});

test('a Year column is the time axis, not a measure', () => {
  const dataset = load('year-column.csv');
  assert.deepEqual(dataset.metrics, ['Revenue']);
  assert.equal(dataset.dateColumn, 'Year');
  assert.deepEqual(aggregate(dataset.rows, 'Year', 'Revenue', dataset).map((group) => [group.label, group.value]), [['2023', 100], ['2024', 150], ['2025', 200]]);
});

test('a numeric Year sorts and labels correctly when cells are real numbers', () => {
  const tables = extractTables([['Year', 'Region', 'Revenue'], [2024, 'West', 150], [2023, 'West', 100], [2025, 'East', 200]], 'Sheet');
  const dataset = datasetProfile(tables[0], 'Sheet', 0, 'book.xlsx');
  assert.deepEqual(dataset.metrics, ['Revenue']);
  assert.equal(dataset.dateColumn, 'Year');
  assert.deepEqual(aggregate(dataset.rows, 'Year', 'Revenue', dataset).map((group) => group.label), ['2023', '2024', '2025']);
});

test('calendar columns become groupings next to a real date column', () => {
  const dataset = load('year-with-date.csv');
  assert.equal(dataset.dateColumn, 'Date');
  assert.ok(!dataset.metrics.includes('Fiscal Year'));
  assert.ok(!dataset.metrics.includes('Quarter'));
  assert.ok(dataset.dimensions.includes('Quarter'));
});

test('"This Year" holding amounts stays a measure', () => {
  assert.ok(load('year-with-date.csv').metrics.includes('This Year'));
});

test('ISO dates stay in their written month in every time zone', () => {
  assert.deepEqual(months(load('year-with-date.csv'), 'Revenue'), [['2025-01', 100], ['2025-02', 200], ['2025-05', 300]]);
  const date = parseDate('2025-01-01');
  assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate()], [2025, 0, 1]);
});

test('impossible ISO dates are rejected', () => {
  assert.equal(parseDate('2025-13-40'), null);
  assert.equal(parseDate('2025-02-31'), null);
});

test('cell text of a Date uses the local calendar day', () => {
  assert.equal(cellText(new Date(2025, 0, 1)), '2025-01-01');
});

test('SheetJS seconds drift is removed without touching real times', () => {
  const drifted = new Date(new Date(2025, 0, 1).getTime() - 10000);
  const timed = new Date(2025, 0, 1, 14, 30);
  const [[fixed, kept, text]] = normalizeSheetDates([[drifted, timed, 'x']]);
  assert.deepEqual([fixed.getFullYear(), fixed.getMonth(), fixed.getDate(), fixed.getHours()], [2025, 0, 1, 0]);
  assert.equal(kept.getTime(), timed.getTime());
  assert.equal(text, 'x');
});

test('wide tables with year headers keep Period out of the measures', () => {
  const tables = extractTables(parseDelimited('Region,2023,2024,2025\nWest,10,20,30\nEast,40,50,60\n', ','), 'Sheet');
  const dataset = datasetProfile(tables[0], 'Sheet', 0, 'wide.csv');
  assert.equal(dataset.dateColumn, 'Period');
  assert.ok(!dataset.metrics.includes('Period'));
});

const { detectDelimiter, prepareMatrix, defaultAggregation, csvCell } = require('../parser.js');
const loadText = (text, delimiter = detectDelimiter(text)) => {
  const tables = extractTables(prepareMatrix(parseDelimited(text, delimiter)), 'Sheet');
  return datasetProfile(tables[0], 'Sheet', 0, 'file.csv');
};
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('semicolon files with decimal commas and dotted dates are read', () => {
  const dataset = loadText(fixture('european.csv'));
  assert.deepEqual(dataset.columns, ['Produkt', 'Region', 'Umsatz', 'Datum']);
  assert.equal(metricTotal(dataset.rows, 'Umsatz', dataset.columns), 3334.4);
  assert.equal(dataset.dateColumn, 'Datum');
  assert.deepEqual(aggregate(dataset.rows, 'Datum', 'Umsatz', dataset).map((group) => group.key), ['2025-01', '2025-02', '2025-03']);
});

test('delimiter detection prefers the consistent separator', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2,5;3\n4;5,5;6\n'), ';');
  assert.equal(detectDelimiter('Report, Q3\n\na,b,c\n1,2,3\n4,5,6\n'), ',');
  assert.equal(detectDelimiter('a\tb\n1\t2\n'), '\t');
});

test('dot-decimal files keep their meaning', () => {
  const dataset = loadText('Item,Amount\nA,"1,234.50"\nB,99.90\nC,"2,000.00"\n');
  assert.equal(metricTotal(dataset.rows, 'Amount', dataset.columns), 3334.4);
});

test('dd.mm.yyyy dates parse and impossible ones do not', () => {
  const date = parseDate('31.01.2025');
  assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate()], [2025, 0, 31]);
  assert.equal(parseDate('31.02.2025'), null);
});

test('prices, rates and ratio margins are averaged; amounts are summed', () => {
  const dataset = load('prices.csv');
  assert.deepEqual(dataset.aggregations, { 'Total Price': 'sum', Quantity: 'sum', 'Unit Price': 'mean', Margin: 'mean' });
  assert.equal(metricTotal(dataset.rows, 'Unit Price', dataset.columns, 'mean'), 20);
  assert.deepEqual(aggregate(dataset.rows, 'Product', 'Unit Price', { ...dataset, method: 'mean', sort: true }).map((group) => [group.label, group.value]), [['Lamp', 30], ['Shirt', 15]]);
  assert.equal(defaultAggregation('Interest Rate', []), 'mean');
  assert.equal(defaultAggregation('Gross Margin', [{ 'Gross Margin': 1200 }]), 'sum');
});

test('an unlabelled total row is excluded when its numbers add up', () => {
  const dataset = load('unlabelled-total.csv');
  assert.equal(dataset.rows.length, 3);
  assert.equal(metricTotal(dataset.rows, 'Revenue', dataset.columns), 600);
  assert.equal(dataset.excludedTotalRows, 1);
});

test('pivot subtotals labelled Total in a later column are excluded', () => {
  const dataset = load('pivot-subtotals.csv');
  assert.equal(metricTotal(dataset.rows, 'Revenue', dataset.columns), 350);
  assert.equal(dataset.excludedTotalRows, 2);
});

test('"Total" as an ordinary value is kept when the numbers do not add up', () => {
  const dataset = load('total-as-value.csv');
  assert.equal(dataset.rows.length, 3);
  assert.equal(dataset.excludedTotalRows, 0);
});

test('CSV cells neutralise formulas but keep numbers and dates readable', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(csvCell('-12.5'), '"-12.5"');
  assert.equal(csvCell(-12.5), '"-12.5"');
  assert.equal(csvCell(new Date(2025, 0, 31)), '"2025-01-31"');
  assert.equal(csvCell(new Date(2025, 0, 31, 9, 5)), '"2025-01-31 09:05"');
});
