const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDelimited, extractTables, datasetProfile, parseDate, cellText, aggregate, sumColumn, isTotalRow, normalizeSheetDates } = require('../parser.js');

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
  assert.equal(sumColumn(dataset.rows, 'Revenue', dataset.columns), 600);
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
  assert.equal(sumColumn(dataset.rows, dataset.metrics[0], dataset.columns), 210);
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
