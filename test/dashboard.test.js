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
