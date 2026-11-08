const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bootDashboard } = require('./dashboard-harness.js');

const sales = 'Date,Category,Region,Revenue,Profit\n2025-01-15,Apparel,West,100,20\n2025-02-15,Home,East,200,30\n2025-03-15,Apparel,East,300,50\n';

test('"show Profit by Region" changes the main chart', async () => {
  const app = bootDashboard();
  await app.upload('sales.csv', sales);
  assert.equal(app.element('main-chart-heading').textContent, 'Revenue over time');
  app.prompt('show Profit by Region');
  assert.equal(app.element('main-chart-heading').textContent, 'Profit by Region');
  assert.equal(app.element('main-metric').value, 'Profit');
  assert.equal(app.element('main-dimension').value, 'Region');
});

test('naming only a metric refocuses the dashboard on it', async () => {
  const app = bootDashboard();
  await app.upload('sales.csv', sales);
  app.prompt('show Profit');
  assert.equal(app.element('main-metric').value, 'Profit');
  assert.equal(app.element('main-chart-heading').textContent, 'Profit over time');
});

test('excluded total rows are disclosed in the subtitle', async () => {
  const app = bootDashboard();
  await app.upload('sales.csv', fs.readFileSync(path.join(__dirname, 'fixtures', 'sales-with-totals.csv'), 'utf8'));
  assert.match(app.element('dashboard-subtitle').textContent, /2 total rows excluded/);
});

async function salesApp(csv = sales) {
  const app = bootDashboard();
  await app.upload('sales.csv', csv);
  return app;
}

test('"analyze revenue" summarises instead of looking for a sheet', async () => {
  const app = await salesApp();
  app.prompt('analyze revenue');
  assert.match(app.element('assistant-response').textContent, /^I looked across 3 rows/);
});

test('"open" with an unknown sheet still says so', async () => {
  const app = await salesApp();
  app.prompt('open quarterly forecast');
  assert.match(app.element('assistant-response').textContent, /couldn’t find a worksheet or table called “quarterly forecast”/);
});

test('"product lines" is not a request for a line chart', async () => {
  const app = await salesApp();
  app.element('main-chart-type').value = 'bar';
  app.prompt('show Revenue by Category lines');
  assert.equal(app.element('main-chart-type').value, 'bar');
  assert.equal(app.element('main-chart-heading').textContent, 'Revenue by Category');
});

test('fields and chart style in one prompt are both applied', async () => {
  const app = await salesApp();
  app.prompt('show profit by region as a bar chart');
  assert.equal(app.element('main-chart-heading').textContent, 'Profit by Region');
  assert.equal(app.element('main-chart-type').value, 'bar');
});

test('"switch to bars" changes the chart style', async () => {
  const app = await salesApp();
  app.prompt('switch to bars');
  assert.equal(app.element('main-chart-type').value, 'bar');
  assert.match(app.element('assistant-response').textContent, /bars/);
});

test('words containing a field name do not match it', async () => {
  const app = await salesApp();
  app.prompt('show Profit by Region');
  // "update" contains "date"; before the fix this regrouped the chart by Date.
  app.prompt('update profit grouping');
  assert.equal(app.element('main-dimension').value, 'Region');
});

test('filtering by a short value needs a whole-word match', async () => {
  // "banana" contains "ana"; before the fix this filtered to the customer Ana.
  const app = await salesApp('Customer,Region,Revenue\nAna,West,1\nBob,East,2\nCy,East,3\n');
  app.prompt('only show banana');
  assert.equal(app.element('filter-value').value, '');
  app.prompt('only show Ana');
  assert.equal(app.element('filter-value').value, 'Ana');
});

test('a filter value beyond the 500 listed options still applies', async () => {
  const rows = Array.from({ length: 600 }, (_, index) => `Customer ${String(index).padStart(3, '0')},${index < 599 ? 2 : 1},East`);
  const app = await salesApp(`Customer,Revenue,Region\n${rows.join('\n')}\n`);
  app.prompt('only show Customer 599');
  assert.equal(app.element('filter-value').value, 'Customer 599');
  assert.match(app.element('main-chart-subtitle').textContent, /Filtered to 1 matching rows/);
});

test('prices are averaged by default and the dropdown can switch to totals', async () => {
  const app = await salesApp(fs.readFileSync(path.join(__dirname, 'fixtures', 'prices.csv'), 'utf8'));
  app.prompt('show unit price by product');
  assert.equal(app.element('main-chart-heading').textContent, 'Average Unit Price by Product');
  assert.equal(app.element('main-aggregation').value, 'mean');
  assert.equal(app.element('chart-total').textContent.replace(/[^\d.]/g, ''), '20');
  app.element('main-aggregation').value = 'sum';
  app.element('main-aggregation').listeners.change[0]();
  assert.equal(app.element('main-chart-heading').textContent, 'Unit Price by Product');
  app.prompt('average quantity by region');
  assert.equal(app.element('main-chart-heading').textContent, 'Average Quantity by Region');
});

function bars(svg) {
  return [...svg.matchAll(/<rect x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)"[^>]*fill="([^"]+)"/g)].map((match) => ({ y: Number(match[1]), height: Number(match[2]), fill: match[3] }));
}

test('negative values draw below a zero line inside the chart', async () => {
  const app = await salesApp('Category,Profit\nA,120\nB,-80\nC,40\n');
  app.element('main-chart-type').value = 'bar';
  app.element('main-chart-type').listeners.change[0]();
  const drawn = bars(app.element('main-chart').innerHTML);
  assert.equal(drawn.length, 3);
  for (const bar of drawn) {
    assert.ok(bar.height > 0 && bar.y >= 10 && bar.y + bar.height <= 171.01, JSON.stringify(bar));
  }
  assert.ok(drawn.some((bar) => bar.fill === '#e67f9b'));
  assert.match(app.element('main-chart').innerHTML, /zero-line/);
  assert.match(app.element('region-footnote').textContent, /Negative values can’t be split into shares/);
});

test('values below 1 use the full height of the chart', async () => {
  const app = await salesApp('Date,Conversion\n2025-01-15,0.1\n2025-02-15,0.3\n2025-03-15,0.2\n');
  const ys = [...app.element('main-chart').innerHTML.matchAll(/<circle cx="[^"]+" cy="([^"]+)"/g)].map((match) => Number(match[1]));
  assert.ok(Math.min(...ys) < 40, `highest point at y=${Math.min(...ys)}`);
});

test('the share chart groups small slices into Other and uses the full total', async () => {
  const regions = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const app = await salesApp(`Category,Region,Revenue\n${regions.map((region, index) => `X,${region},${10 + index}`).join('\n')}\n`);
  const legend = app.element('region-legend').innerHTML;
  assert.match(legend, /Other \(3\)/);
  assert.equal(app.element('region-footnote').textContent, 'Share of total revenue');
  const shares = [...legend.matchAll(/legend-value">(\d+)%/g)].map((match) => Number(match[1]));
  assert.ok(Math.abs(shares.reduce((sum, value) => sum + value, 0) - 100) <= 3, shares.join(','));
});

test('the ranked table counts groups, not rows', async () => {
  const app = await salesApp();
  assert.equal(app.element('row-count').textContent, 'Showing 2 of 2 groups');
});

const indian = fs.readFileSync(path.join(__dirname, 'fixtures', 'indian-sales.csv'), 'utf8');

test('an Indian invoice sheet uploads with day-first dates and monthly trend', async () => {
  const app = bootDashboard({ navigator: { language: 'en-US' } });
  await app.upload('invoices.csv', indian);
  assert.equal(app.element('main-chart-heading').textContent, 'Amount over time');
  // 13/04 forces day-first even in a US browser; Jun vs May is the latest change.
  assert.equal(app.element('chart-delta').textContent, '+67.3%');
  assert.match(app.element('chart-delta').title, /compared with/);
});

test('ambiguous dates follow the browser locale', async () => {
  const csv = 'Date,Region,Amount\n03/04/2025,West,10\n04/05/2025,East,20\n';
  const india = bootDashboard({ navigator: { language: 'en-IN' } });
  await india.upload('a.csv', csv);
  const us = bootDashboard({ navigator: { language: 'en-US' } });
  await us.upload('a.csv', csv);
  assert.notEqual(india.element('main-chart').innerHTML, us.element('main-chart').innerHTML);
  assert.match(india.element('main-chart').innerHTML, /Apr/);
  assert.match(us.element('main-chart').innerHTML, /Mar/);
});

test('KPI badges show real period changes, never Live or Healthy', async () => {
  const app = await salesApp();
  const kpis = app.element('kpi-grid').innerHTML;
  assert.doesNotMatch(kpis, /Live|Healthy|Review|Ready/);
  assert.match(kpis, /\+50\.0% vs /);
});

test('Share copies a text summary of the current view', async () => {
  let copied = '';
  const app = bootDashboard({ navigator: { language: 'en-IN', clipboard: { writeText: async (text) => { copied = text; } } } });
  await app.upload('sales.csv', sales);
  app.prompt('only show East');
  await app.element('share-button').listeners.click[0]();
  assert.match(copied, /^sales \(filtered to Region = East\)\n2 rows\. Total Revenue is 500/);
});
