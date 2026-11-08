// End to end with the SheetJS build the site ships: write a real .xlsx, read it back the way
// app.js does, and check dates land in the right month. Run under several TZ values.
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx-0.20.3/xlsx.full.min.js');
const { prepareMatrix, extractTables, datasetProfile, aggregate } = require('../parser.js');

function roundTrip(rows, format) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const address of Object.keys(sheet)) {
    if (address[0] === 'A' && typeof sheet[address].v === 'number') { sheet[address].t = 'n'; sheet[address].z = format; }
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Sales');
  const read = XLSX.read(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true, cellNF: true });
  const matrix = prepareMatrix(XLSX.utils.sheet_to_json(read.Sheets.Sales, { header: 1, defval: '', raw: true, blankrows: true }), { dayFirst: true });
  return datasetProfile(extractTables(matrix, 'Sales')[0], 'Sales', 0, 'sales.xlsx');
}

test('ships SheetJS 0.20.3', () => assert.equal(XLSX.version, '0.20.3'));

test('Excel date cells on the 1st stay in their month', () => {
  // 45658 = 1 Jan 2025, 45689 = 1 Feb 2025, 45717 = 1 Mar 2025 (Excel serials)
  const dataset = roundTrip([['Date', 'Region', 'Revenue'], [45658, 'West', 1], [45689, 'East', 2], [45717, 'West', 3], ['Total', '', 6]], 'dd/mm/yyyy');
  assert.deepEqual(aggregate(dataset.rows, dataset.dateColumn, 'Revenue', dataset).map((group) => [group.key, group.value]), [['2025-01', 1], ['2025-02', 2], ['2025-03', 3]]);
  assert.equal(dataset.excludedTotalRows, 1);
});

test('dates typed as text in Excel are read day-first', () => {
  const dataset = roundTrip([['Date', 'Region', 'Revenue'], ['13/04/2025', 'West', 1], ['02/05/2025', 'East', 2], ['01/06/2025', 'West', 3]], 'General');
  assert.deepEqual(aggregate(dataset.rows, dataset.dateColumn, 'Revenue', dataset).map((group) => group.key), ['2025-04', '2025-05', '2025-06']);
});
