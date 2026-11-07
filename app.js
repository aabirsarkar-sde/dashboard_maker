(() => {
  'use strict';

  const state = {
    allRows: [], rows: [], columns: [], metrics: [], dimensions: [], dateColumn: '',
    metric: '', dimension: '', categoryDimension: '', regionDimension: '', filters: {},
    mainType: 'line', mainTitle: '', dashboardTitle: '', fileName: '', sheetName: '',
    topN: 5, extraCharts: [], datasets: [], sheetReports: [], activeDatasetIndex: -1,
    periodColumn: '', currencySymbol: '', workbookName: '', workbookCount: 1, toastTimer: null,
  };
  const palette = ['#8778eb', '#56b47f', '#f0ae59', '#73a4e8', '#e67f9b', '#58b8bf', '#a888d7', '#c2bd70'];
  const $ = (id) => document.getElementById(id);

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) return NaN;
    if (value == null || String(value).trim() === '') return NaN;
    let text = String(value).trim().replace(/[,$£€¥₹\s]/g, '');
    const negative = /^\(.*\)$/.test(text);
    text = text.replace(/[()%]/g, '');
    const number = Number(text);
    return Number.isFinite(number) ? (negative ? -number : number) : NaN;
  }
  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' || value == null || String(value).trim() === '') return null;
    const text = String(value).trim();
    const period = parsePeriodHeader(text);
    if (period?.date) return period.date;
    if (/^\d{1,5}$/.test(text)) return null;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getFullYear() < 1900 || date.getFullYear() > 2200) return null;
    return date;
  }
  function compact(value, digits = 1) {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(digits).replace(/\.0$/, '')}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(digits).replace(/\.0$/, '')}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(digits).replace(/\.0$/, '')}K`;
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: abs < 10 ? 1 : 0 }).format(value);
  }
  function money(value, short = false) {
    if (short) return `${state.currencySymbol}${compact(value)}`;
    return `${state.currencySymbol}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)}`;
  }
  function metricFormat(value, metric, short = false) {
    const name = String(metric || '').toLowerCase();
    if (/%|margin|rate|conversion/.test(name) && Math.abs(value) <= 1) return `${(value * 100).toFixed(1)}%`;
    if (/revenue|sales|amount|profit|price|cost|income|value|total/.test(name)) return money(value, short);
    return short ? compact(value) : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  }
  function sumMetric(rows, metric) {
    if (!metric || metric === 'Records' || !state.columns.includes(metric)) return rows.length;
    return rows.reduce((sum, row) => {
      const value = toNumber(row[metric]);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }
  function unique(values) { return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]; }
  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }
  function setResponse(message) {
    const response = $('assistant-response');
    response.textContent = message;
    response.hidden = false;
  }
  function escapeXml(value) { return escapeHTML(value); }
  function shortLabel(value, limit = 15) {
    const text = String(value ?? '');
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }

  function cleanCell(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
    return value;
  }
  function cellText(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').replace(/\s+/g, ' ').trim(); }
  function isEmptyCell(value) { return value == null || String(value).trim() === ''; }
  function periodYear(value) {
    const text = cellText(value).replace(/^FY\s*/i, '');
    const match = text.match(/^(19\d{2}|20\d{2})(?:[-–/]\d{2,4})?$/);
    return match ? Number(match[1]) : null;
  }
  function parsePeriodHeader(value, parentYear = null) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const year = value.getFullYear(), month = value.getMonth();
      return { label: value.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), date: new Date(year, month, 1), order: year * 12 + month };
    }
    if (typeof value === 'number' && value >= 20000 && value <= 90000) {
      const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
      if (!Number.isNaN(date.getTime())) {
        const year = date.getUTCFullYear(), month = date.getUTCMonth();
        return { label: date.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }), date: new Date(year, month, 1), order: year * 12 + month };
      }
    }
    const raw = cellText(value).replace(/[\n\r]+/g, ' ').trim();
    if (!raw) return null;
    const yearOnly = periodYear(raw);
    if (yearOnly) {
      const fiscal = /^(?:FY\s*)?(19\d{2}|20\d{2})[-–/]\d{2,4}$/i.test(raw);
      return { label: raw, date: new Date(yearOnly, fiscal ? 3 : 0, 1), order: yearOnly * 12 + (fiscal ? 3 : 0) };
    }
    if (/^(?:year|yr)\s*\d+$/i.test(raw)) return { label: raw, date: null, order: Number(raw.match(/\d+/)[0]) };
    const monthIndex = (month) => {
      const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const value = String(month).toLowerCase().slice(0, 3);
      return names.indexOf(value);
    };
    const range = raw.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{4})\s+to\s+/i);
    if (range) {
      const month = monthIndex(range[1]), year = Number(range[2]);
      return { label: raw, date: new Date(year, month, 1), order: year * 12 + month };
    }
    let match = raw.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?[-\s/]*(\d{2,4})$/i);
    if (match || (parentYear && /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?$/i.test(raw))) {
      const monthName = match ? match[1] : raw;
      let year = match ? Number(match[2]) : parentYear;
      if (year < 100) year += year < 70 ? 2000 : 1900;
      const month = monthIndex(monthName);
      const label = match ? raw : `${monthName.slice(0, 3)} ${year}`;
      return { label, date: new Date(year, month, 1), order: year * 12 + month };
    }
    return null;
  }
  function isPeriodHeader(value) { return Boolean(parsePeriodHeader(value)); }
  function headerKey(value, index) {
    const text = cellText(value).replace(/\s+/g, ' ').trim();
    return text || `Field ${index + 1}`;
  }

  function chooseMetric(columns, rows) {
    const numeric = columns.filter((column) => {
      const values = rows.map((row) => row[column]).filter((value) => !isEmptyCell(value));
      return values.length > 0 && values.filter((value) => Number.isFinite(toNumber(value))).length / values.length >= 0.62;
    });
    const usable = numeric.filter((column) => !/(^id$|_id$|\bid\b|zip|postal|phone|latitude|longitude|^sr\s*no|serial|invoice\s*(no|number)|voucher\s*(no|number)|payment\s*number)/i.test(column));
    const priority = (column) => {
      const name = column.toLowerCase();
      if (/revenue|sales|gross|net|amount|profit|income|value|total/.test(name)) return 0;
      if (/units|quantity|qty|orders|count|person|employee/.test(name)) return 1;
      if (/price|cost|rate|salary|balance|principal|interest/.test(name)) return 2;
      return 3;
    };
    return usable.sort((a, b) => priority(a) - priority(b));
  }

  function measureHint(value) {
    const text = cellText(value).toLowerCase();
    if (!text || /column labels|row labels|grand total|supplier|multiple items/.test(text)) return '';
    return /quantity|\bqty\b|sales|sale\s*qty|amount|revenue|profit|purchase|volume|turnover|income/.test(text) ? cellText(value) : '';
  }
  function normalizeMeasure(value, fallback) {
    const text = cellText(value).replace(/^sum of\s*/i, '').replace(/^actual\s*/i, '').replace(/^average monthly\s*/i, '').replace(/^avg monthly\s*/i, '').trim();
    if (!text) return fallback;
    if (/quantity|\bqty\b/i.test(text)) return 'Quantity';
    if (/amount|revenue/i.test(text)) return /purchase/i.test(text) ? 'Purchase Amount' : 'Sales Amount';
    if (/sales|sale/i.test(text)) return 'Sales';
    if (/profit/i.test(text)) return 'Profit';
    if (/volume/i.test(text)) return 'Volume';
    return text;
  }
  function inferredMeasureHint(sheetName, rows) {
    const text = `${sheetName} ${rows.map((row) => Object.keys(row).join(' ')).join(' ')}`.toLowerCase();
    if (/quantity|\bqty\b|\bunits?\b|volume/.test(text)) return 'Quantity';
    if (/purchase/.test(text)) return 'Purchase Amount';
    if (/sales|sale|lost customer|portfolio/.test(text)) return 'Sales Amount';
    if (/amount|revenue|profit|income|cost|price|salary|ev summary/.test(text)) return 'Amount';
    return 'Value';
  }
  function isTotalHeader(value) { return /^(grand\s+total|total\s+result|overall\s+total|total)$/i.test(cellText(value)); }
  function isTotalRow(value) { return /^(grand\s+total|total\s+result|overall\s+total)$/i.test(cellText(value)); }
  function rowValue(matrix, rowIndex, colIndex) { return matrix[rowIndex]?.[colIndex] ?? ''; }
  function parentYearForColumn(matrix, headerRow, column) {
    for (let rowIndex = headerRow - 1; rowIndex >= Math.max(0, headerRow - 4); rowIndex -= 1) {
      let year = null;
      for (let col = 0; col <= column; col += 1) {
        const value = rowValue(matrix, rowIndex, col);
        const parsed = periodYear(value);
        if (parsed) year = parsed;
      }
      if (year) return year;
    }
    return null;
  }
  function normalizedHeader(matrix, rowIndex, column) {
    const value = rowValue(matrix, rowIndex, column);
    if (!isEmptyCell(value)) {
      const parentYear = parentYearForColumn(matrix, rowIndex, column);
      return parsePeriodHeader(value, parentYear)?.label || cellText(value);
    }
    return '';
  }
  function candidateDataStart(matrix, rowIndex, columns) {
    const last = Math.min(matrix.length, rowIndex + 14);
    for (let start = rowIndex + 1; start < last; start += 1) {
      const vals = columns.map((column) => rowValue(matrix, start, column)).filter((value) => !isEmptyCell(value));
      if (vals.length < 2) continue;
      const hasMeasure = vals.some((value) => Number.isFinite(toNumber(value)) || value instanceof Date);
      let support = 0;
      for (let r = start; r < Math.min(matrix.length, start + 6); r += 1) {
        if (columns.filter((column) => !isEmptyCell(rowValue(matrix, r, column))).length >= 2) support += 1;
      }
      if (hasMeasure || support >= 3) return start;
    }
    return -1;
  }
  function headerRegions(matrixRow) {
    const indices = [];
    matrixRow.forEach((value, index) => { if (!isEmptyCell(value)) indices.push(index); });
    if (!indices.length) return [];
    const regions = [];
    let start = indices[0], end = indices[0];
    for (let i = 1; i < indices.length; i += 1) {
      if (indices[i] - end <= 2) end = indices[i];
      else { regions.push([start, end]); start = indices[i]; end = indices[i]; }
    }
    regions.push([start, end]);
    return regions;
  }
  function deriveCandidate(matrix, rowIndex, left, right) {
    let start = left;
    if (start > 0 && isEmptyCell(rowValue(matrix, rowIndex, start - 1)) && !isEmptyCell(rowValue(matrix, rowIndex + 1, start - 1))) start -= 1;
    const columns = Array.from({ length: right - start + 1 }, (_, index) => start + index);
    const rawHeaders = columns.map((column) => normalizedHeader(matrix, rowIndex, column));
    const periodCount = rawHeaders.filter((header) => isPeriodHeader(header)).length;
    const nextValues = columns.map((column) => rowValue(matrix, rowIndex + 1, column));
    const nextCount = nextValues.filter((value) => !isEmptyCell(value)).length;
    const mergeNext = nextCount > 0 && nextCount <= Math.max(2, Math.floor(columns.length * 0.28)) && periodCount >= Math.max(2, Math.floor(columns.length * 0.35));
    const headers = rawHeaders.map((header, index) => header || (mergeNext ? cellText(nextValues[index]) : '') || `Field ${index + 1}`);
    const cleanHeaders = [];
    const seen = new Map();
    headers.forEach((header, index) => {
      let name = headerKey(header, index);
      const count = (seen.get(name) || 0) + 1;
      seen.set(name, count);
      if (count > 1) name = `${name} (${count})`;
      cleanHeaders.push(name);
    });
    const startRow = candidateDataStart(matrix, rowIndex, columns);
    if (startRow < 0) return null;
    const sampleEnd = Math.min(matrix.length, startRow + 16);
    let support = 0, numericCells = 0, valueCells = 0;
    for (let r = startRow; r < sampleEnd; r += 1) {
      let count = 0;
      for (const column of columns) {
        const value = rowValue(matrix, r, column);
        if (!isEmptyCell(value)) { count += 1; valueCells += 1; if (Number.isFinite(toNumber(value))) numericCells += 1; }
      }
      if (count >= Math.min(2, columns.length)) support += 1;
    }
    const named = cleanHeaders.filter((header) => /name|date|time|month|year|quantity|qty|amount|sales|revenue|profit|price|cost|customer|product|item|category|region|supplier|party|voucher|invoice|salary|range|person|balance|principal|interest|period|row labels/i.test(header)).length;
    const periodHeaders = cleanHeaders.filter((header) => isPeriodHeader(header)).length;
    const textHeaders = rawHeaders.filter((header) => header && !Number.isFinite(Number(header))).length;
    const meta = cleanHeaders.some((header) => /^(sum of|column labels|row labels|multiple items|all items|enter values|loan summary)$/i.test(header));
    const quality = columns.length * 1.25 + named * 2.8 + periodHeaders * 1.2 + textHeaders * 0.45 + Math.min(support, 12) * 1.45 + (valueCells ? numericCells / valueCells : 0) * 4 - (meta ? 11 : 0);
    let dataEnd = startRow, blankRun = 0;
    for (let r = startRow; r < matrix.length; r += 1) {
      if (columns.some((column) => !isEmptyCell(rowValue(matrix, r, column)))) { dataEnd = r; blankRun = 0; }
      else if (++blankRun >= 3) break;
    }
    return { rowIndex, columns, headers: cleanHeaders, rawHeaders, startRow, dataEnd, score: quality, support, semanticCount: named, periodCount: periodHeaders };
  }
  function isLikelyOneColumnList(matrix, sheetName) {
    const rows = matrix.filter((row) => row.some((value) => !isEmptyCell(value)));
    if (rows.length < 5) return null;
    const width = Math.max(...rows.slice(0, 12).map((row) => row.filter((value) => !isEmptyCell(value)).length));
    if (width !== 1) return null;
    const header = cellText(rows[0].find((value) => !isEmptyCell(value)));
    const values = rows.slice(1).map((row) => row.find((value) => !isEmptyCell(value))).filter((value) => !isEmptyCell(value));
    if (!header || values.length < 3 || values.some((value) => Number.isFinite(toNumber(value)))) return null;
    return { rows: values.map((value) => ({ [header]: cleanCell(value) })), headers: [header], startRow: 1, dataEnd: rows.length - 1, score: values.length + 2, support: values.length, periodColumn: '', tableLabel: sheetName };
  }
  function measureGroupLabels(matrix, candidate, periodColumns) {
    for (let rowIndex = candidate.rowIndex - 1; rowIndex >= Math.max(0, candidate.rowIndex - 4); rowIndex -= 1) {
      const found = [];
      let active = '';
      for (const periodColumn of periodColumns) {
        for (let col = candidate.columns[0]; col <= periodColumn.column; col += 1) {
          const hint = measureHint(rowValue(matrix, rowIndex, col));
          if (hint) active = hint;
        }
        if (active) found.push({ column: periodColumn.column, label: normalizeMeasure(active, 'Value') });
      }
      const distinct = unique(found.map((item) => item.label));
      if (distinct.length >= 2) return found;
      if (distinct.length === 1) return [{ column: periodColumns[0]?.column ?? candidate.columns[0], label: distinct[0] }];
    }
    return [];
  }
  function unpivotCandidate(matrix, candidate, sheetName) {
    const periods = candidate.columns.map((column, index) => ({ column, index, info: parsePeriodHeader(candidate.headers[index]) }))
      .filter((item) => item.info && !isTotalHeader(candidate.headers[item.index]));
    if (periods.length < 2) return null;
    let numericPeriods = 0;
    for (const period of periods) {
      const sample = matrix.slice(candidate.startRow, Math.min(candidate.dataEnd + 1, candidate.startRow + 25)).map((row) => row[period.column]);
      const values = sample.filter((value) => !isEmptyCell(value));
      if (values.length && values.filter((value) => Number.isFinite(toNumber(value))).length / values.length >= 0.45) numericPeriods += 1;
    }
    if (numericPeriods < 2 || numericPeriods / periods.length < 0.55) return null;
    const groupLabels = measureGroupLabels(matrix, candidate, periods);
    const fallbackHint = groupLabels[0]?.label || inferredMeasureHint(sheetName, []);
    const groups = [];
    let activeGroup = fallbackHint;
    periods.forEach((period) => {
      for (const hint of groupLabels) if (hint.column <= period.column) activeGroup = hint.label;
      period.group = groupLabels.length > 1 ? activeGroup : (groupLabels[0]?.label || fallbackHint);
      if (!groups.includes(period.group)) groups.push(period.group);
    });
    const headers = candidate.headers;
    const otherColumns = candidate.columns.map((column, index) => ({ column, name: headers[index], index }))
      .filter((item) => !periods.some((period) => period.column === item.column) && !isTotalHeader(item.name));
    const output = [];
    for (let r = candidate.startRow; r <= candidate.dataEnd; r += 1) {
      const source = matrix[r] || [];
      const firstLabel = cellText(rowValue(matrix, r, otherColumns[0]?.column));
      if (isTotalRow(firstLabel)) continue;
      const dimensions = {};
      otherColumns.forEach(({ column, name }) => { dimensions[name] = cleanCell(source[column]); });
      const perGroup = new Map();
      periods.forEach((period) => {
        const value = toNumber(source[period.column]);
        if (!Number.isFinite(value)) return;
        if (!perGroup.has(period.info.label)) perGroup.set(period.info.label, { Period: period.info.label });
        perGroup.get(period.info.label)[period.group] = value;
      });
      perGroup.forEach((periodRow) => {
        const row = { ...dimensions, ...periodRow };
        if (Object.keys(row).some((key) => key !== 'Period' && !isEmptyCell(row[key]))) output.push(row);
      });
    }
    if (!output.length) return null;
    return { rows: output, headers: [...otherColumns.map((item) => item.name), 'Period', ...groups], startRow: candidate.startRow, dataEnd: candidate.dataEnd, score: candidate.score + output.length / 100, support: candidate.support, periodColumn: 'Period', measureGroups: groups };
  }
  function regularCandidateRows(matrix, candidate) {
    const output = [];
    for (let r = candidate.startRow; r <= candidate.dataEnd; r += 1) {
      const source = matrix[r] || [];
      if (!candidate.columns.some((column) => !isEmptyCell(source[column]))) continue;
      const row = Object.fromEntries(candidate.columns.map((column, index) => [candidate.headers[index], cleanCell(source[column])]));
      const first = cellText(row[candidate.headers[0]]);
      if (isTotalRow(first)) continue;
      const notEmpty = Object.values(row).filter((value) => !isEmptyCell(value)).length;
      if (notEmpty >= Math.min(2, candidate.columns.length)) output.push(row);
    }
    return output;
  }
  function extractTables(matrix, sheetName) {
    const candidates = [];
    const scanTo = Math.min(matrix.length, 100);
    for (let rowIndex = 0; rowIndex < scanTo; rowIndex += 1) {
      for (const [left, right] of headerRegions(matrix[rowIndex] || [])) {
        const candidate = deriveCandidate(matrix, rowIndex, left, right);
        if (candidate) candidates.push(candidate);
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const selected = [];
    candidates.forEach((candidate) => {
      const meta = candidate.headers.some((header) => /^(sum of|column labels|row labels|multiple items|all items)/i.test(header));
      const adjacentBetter = candidates.some((other) => other !== candidate && other.score > candidate.score + 4 && other.rowIndex > candidate.rowIndex && other.rowIndex <= candidate.rowIndex + 4 && other.columns.length >= candidate.columns.length * 1.5 && other.periodCount >= 2);
      if (meta && adjacentBetter) return;
      const overlapping = selected.some((other) => {
        const intersect = candidate.columns.filter((column) => other.columns.includes(column)).length;
        const ratio = intersect / Math.max(1, new Set([...candidate.columns, ...other.columns]).size);
        const laterHeader = candidate.semanticCount >= Math.max(2, other.semanticCount) && candidate.rowIndex > other.rowIndex + 2;
        return ratio >= 0.78 && candidate.rowIndex >= other.rowIndex && candidate.rowIndex <= other.dataEnd && !laterHeader;
      });
      if (!overlapping) selected.push(candidate);
    });
    selected.sort((a, b) => a.rowIndex - b.rowIndex || a.columns[0] - b.columns[0]);
    const tables = selected.map((candidate) => {
      const reshaped = unpivotCandidate(matrix, candidate, sheetName);
      const rows = reshaped?.rows || regularCandidateRows(matrix, candidate);
      if (!rows.length) return null;
      return { ...candidate, ...reshaped, rows, headers: reshaped?.headers || candidate.headers, periodColumn: reshaped?.periodColumn || '' };
    }).filter(Boolean);
    if (!tables.length) {
      const list = isLikelyOneColumnList(matrix, sheetName);
      if (list) tables.push(list);
    }
    return tables;
  }

  function datasetProfile(table, sheetName, tableIndex, fileName, currencySymbol = '') {
    const rows = table.rows.filter((row) => row && Object.values(row).some((value) => !isEmptyCell(value)));
    const columns = [...new Set(table.headers || Object.keys(rows[0] || {}))].filter(Boolean);
    const metrics = chooseMetric(columns, rows);
    const periodColumn = table.periodColumn || '';
    const dateCandidate = periodColumn || columns.find((column) => /date|time|month|period|day/i.test(column) && rows.filter((row) => parseDate(row[column])).length / Math.max(rows.length, 1) >= 0.48)
      || columns.find((column) => rows.filter((row) => parseDate(row[column])).length / Math.max(rows.length, 1) >= 0.78)
      || '';
    const dimensions = columns.filter((column) => {
      if (column === dateCandidate || metrics.includes(column) || /comments?|description|notes?|address|postal|phone|tariff|alias/i.test(column)) return false;
      const values = rows.map((row) => row[column]).filter((value) => !isEmptyCell(value));
      const cardinality = unique(values).length;
      if (cardinality < 2 || !values.length) return false;
      const numericRatio = values.filter((value) => Number.isFinite(toNumber(value))).length / values.length;
      if (numericRatio > 0.8) return /^(year|fy|rank|category|type)$/i.test(column) && cardinality <= 40;
      if (cardinality > Math.max(1500, rows.length * 0.98) && /invoice|voucher|reference|serial|batch|id|code|number/i.test(column)) return false;
      return true;
    });
    const categoryDimension = dimensions.find((column) => /category|product|item|service|department|team|segment|channel|industry|application|salary range|range/i.test(column))
      || dimensions.find((column) => /customer|party|supplier|employee|person|name|type|group/i.test(column)) || dimensions[0] || '';
    const regionDimension = dimensions.find((column) => /region|country|state|city|location|market|area|sales person|owner|supplier|customer/i.test(column) && column !== categoryDimension)
      || dimensions.find((column) => column !== categoryDimension) || categoryDimension;
    const periodCount = dateCandidate ? unique(rows.map((row) => row[dateCandidate])).length : 0;
    const baseSheetTitle = /^sheet\s*\d*$/i.test(sheetName) ? stripExtension(fileName) || sheetName : sheetName;
    const title = table.tableLabel || `${baseSheetTitle}${tableIndex > 0 ? ` · Table ${tableIndex + 1}` : ''}`;
    const hint = unique(table.measureGroups || []);
    const rowScore = Math.log10(rows.length + 1) * 6 + Math.min(metrics.length, 5) * 2 + Math.min(dimensions.length, 7) + (dateCandidate ? 3 : 0) + (hint.length ? 1 : 0);
    return { rows, columns, metrics, dimensions, dateColumn: dateCandidate, periodColumn, categoryDimension, regionDimension, sheetName, tableIndex, title, fileName, currencySymbol, tableScore: table.score || 0, rankScore: rowScore };
  }

  function activateDataset(index) {
    const dataset = state.datasets[index];
    if (!dataset) return;
    state.activeDatasetIndex = index;
    $('empty-state').hidden = true;
    $('data').hidden = false;
    $('data').classList.remove('overview-mode');
    state.allRows = dataset.rows;
    state.rows = [...dataset.rows];
    state.columns = dataset.columns;
    state.metrics = dataset.metrics;
    state.dimensions = dataset.dimensions;
    state.dateColumn = dataset.dateColumn;
    state.periodColumn = dataset.periodColumn;
    state.categoryDimension = dataset.categoryDimension;
    state.regionDimension = dataset.regionDimension;
    state.currencySymbol = dataset.currencySymbol || '';
    state.metric = state.metrics[0] || '';
    state.dimension = state.dateColumn || state.dimensions[0] || '';
    state.filters = {};
    state.topN = 5;
    state.mainTitle = '';
    state.extraCharts = [];
    state.sheetName = dataset.sheetName;
    state.fileName = dataset.title;
    state.dashboardTitle = dataset.title;
    $('dashboard-title').textContent = dataset.title;
    $('sidebar-dashboard-name').textContent = dataset.title;
    $('sidebar-active-dashboard').hidden = false;
    $('sidebar-empty-note').hidden = true;
    $('nav-count').textContent = state.datasets.length.toLocaleString();
    $('add-chart').hidden = false;
    $('share-button').hidden = false;
    $('export-button').hidden = false;
    $('dashboard-subtitle').textContent = `${dataset.sheetName} · ${dataset.rows.length.toLocaleString()} rows analyzed${dataset.periodColumn ? ' · period columns reshaped automatically' : ''}.`;
    const exampleMetric = dataset.metrics[0] || '';
    const exampleDimension = dataset.categoryDimension || dataset.dimensions[0] || '';
    const fieldSuggestion = $('suggestions').querySelector('[data-prompt*=" by "]');
    if (fieldSuggestion && exampleMetric && exampleDimension) {
      const instruction = `show ${exampleMetric} by ${exampleDimension}`;
      fieldSuggestion.dataset.prompt = instruction;
      fieldSuggestion.textContent = `↗ ${shortLabel(`${exampleMetric} by ${exampleDimension}`, 38)}`;
      fieldSuggestion.hidden = false;
      $('prompt-input').placeholder = `Try “${instruction}” or “filter to a value”`;
    } else {
      if (fieldSuggestion) fieldSuggestion.hidden = true;
      $('prompt-input').placeholder = 'Try “what stands out?” or adjust the chart controls';
    }
    $('source-name').textContent = state.workbookName || dataset.fileName;
    $('source-meta').textContent = `${dataset.sheetName}${dataset.tableIndex > 0 ? ` · Table ${dataset.tableIndex + 1}` : ''} · ${dataset.rows.length.toLocaleString()} rows · ${dataset.columns.length} fields${state.sheetReports.length > 1 ? ` · ${state.sheetReports.length} sheets scanned` : ''}${state.workbookCount > 1 ? ` · ${state.workbookCount} workbooks` : ''}`;
    $('filter-column').replaceChildren(new Option('Select a field', ''));
    state.dimensions.forEach((column) => $('filter-column').add(new Option(column, column)));
    $('filter-value').replaceChildren(new Option('All values', ''));
    $('filter-value').disabled = true;
    $('clear-filter').disabled = true;
    $('assistant-response').hidden = true;
    $('workbook-overview').hidden = true;
    $('ask-card').hidden = false;
    $('kpi-grid').hidden = false;
    $('visualizations').hidden = false;
    $('extra-charts').hidden = false;
    renderSheetNav();
    renderDashboard();
  }

  function renderSheetNav() {
    const nav = $('sheet-nav');
    if (!state.datasets.length) { nav.hidden = true; nav.innerHTML = ''; return; }
    nav.hidden = state.datasets.length <= 1 && state.sheetReports.length <= 1;
    if (nav.hidden) return;
    nav.innerHTML = `<button class="sheet-tab sheet-tab-overview ${state.activeDatasetIndex < 0 ? 'active' : ''}" data-overview="true">All sheets</button>${state.datasets.map((dataset, index) => `<button class="sheet-tab ${index === state.activeDatasetIndex ? 'active' : ''}" data-dataset-index="${index}" title="${escapeHTML(dataset.title)}"><span>${escapeHTML(shortLabel(dataset.title, 24))}</span><span class="sheet-tab-count">${dataset.rows.length.toLocaleString()}</span></button>`).join('')}`;
  }

  function renderWorkbookOverview() {
    $('empty-state').hidden = true;
    $('data').hidden = false;
    $('data').classList.add('overview-mode');
    const totalRows = state.datasets.reduce((sum, dataset) => sum + dataset.rows.length, 0);
    const measures = unique(state.datasets.flatMap((dataset) => dataset.metrics));
    const structuredSheets = new Set(state.datasets.map((dataset) => dataset.sheetName)).size;
    const noTables = state.sheetReports.filter((report) => report.tableCount === 0).length;
    $('overview-title').textContent = `${stripExtension(state.workbookName) || 'Workbook'} · all sheets`;
    $('dashboard-title').textContent = `${stripExtension(state.workbookName) || 'Workbook'} · overview`;
    $('sidebar-dashboard-name').textContent = $('dashboard-title').textContent;
    $('dashboard-subtitle').textContent = 'Every worksheet was scanned. Open an analyzed table to explore its dashboard.';
    $('source-name').textContent = state.workbookName || 'Spreadsheet';
    $('nav-count').textContent = state.datasets.length.toLocaleString();
    $('sidebar-active-dashboard').hidden = state.datasets.length === 0;
    $('sidebar-empty-note').hidden = state.datasets.length > 0;
    if (!state.datasets.length) $('sidebar-empty-note').textContent = 'No clear tables were found in this workbook.';
    $('add-chart').hidden = true;
    $('share-button').hidden = true;
    $('export-button').hidden = true;
    $('source-meta').textContent = `${state.workbookCount > 1 ? `${state.workbookCount} workbooks · ` : ''}${state.sheetReports.length} worksheets scanned · ${state.datasets.length} tables found`;
    $('overview-summary').textContent = `Scanned ${state.sheetReports.length} worksheets${state.workbookCount > 1 ? ` across ${state.workbookCount} workbooks` : ''} and found ${state.datasets.length} structured table${state.datasets.length === 1 ? '' : 's'} across ${structuredSheets} worksheet${structuredSheets === 1 ? '' : 's'}.${noTables ? ` ${noTables} sheet${noTables === 1 ? '' : 's'} had no clear data table.` : ''}`;
    const stats = [
      ['Worksheets scanned', state.sheetReports.length],
      ['Tables found', state.datasets.length],
      ['Rows across views', totalRows.toLocaleString()],
      ['Measures detected', measures.length],
    ];
    $('overview-stats').innerHTML = stats.map(([label, value]) => `<div class="overview-stat"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`).join('');
    const cards = [];
    state.datasets.forEach((dataset, index) => {
      const summary = `${dataset.rows.length.toLocaleString()} rows · ${dataset.metrics.length} measures · ${dataset.dimensions.length} dimensions`;
      const fields = dataset.columns.slice(0, 5).join(', ');
      cards.push(`<button class="sheet-card" data-open-dataset="${index}"><span class="sheet-card-top"><span class="sheet-card-icon">▤</span><span class="sheet-card-title" title="${escapeHTML(dataset.title)}">${escapeHTML(dataset.title)}</span><span class="sheet-card-arrow">→</span></span><span class="sheet-card-meta"><span>${escapeHTML(summary)}</span></span><span class="sheet-card-description">Fields: ${escapeHTML(fields || 'No headers')}</span></button>`);
    });
    state.sheetReports.filter((report) => report.tableCount === 0).forEach((report) => {
      cards.push(`<button class="sheet-card sheet-card-empty" disabled><span class="sheet-card-top"><span class="sheet-card-icon">◌</span><span class="sheet-card-title" title="${escapeHTML(report.sheetName)}">${escapeHTML(report.sheetName)}</span><span class="sheet-card-arrow">·</span></span><span class="sheet-card-meta"><span>${report.cellCount.toLocaleString()} populated cells</span><span>Needs a clearer table</span></span><span class="sheet-card-description">This sheet was scanned, but Atlas couldn’t identify a reliable header row and data table.</span></button>`);
    });
    $('overview-count').textContent = `${cards.length} sheet views`;
    $('overview-cards').innerHTML = cards.join('') || '<div class="empty-chart">No structured tables were found. Try another file or a CSV export.</div>';
    $('workbook-overview').hidden = false;
    $('ask-card').hidden = true;
    $('kpi-grid').hidden = true;
    $('visualizations').hidden = true;
    $('extra-charts').hidden = true;
    $('sheet-nav').hidden = false;
    state.activeDatasetIndex = -1;
    renderSheetNav();
  }

  function loadWorkbookMatrices(sheetMatrices, fileName, currencySymbol = '', workbookCount = 1) {
    state.workbookCount = workbookCount;
    state.workbookName = workbookCount > 1 ? `${workbookCount} workbooks` : (fileName || 'Spreadsheet');
    state.datasets = [];
    state.sheetReports = [];
    sheetMatrices.forEach(({ sheetName, matrix, sourceFileName, sheetCurrencySymbol }) => {
      const nonEmptyCells = matrix.reduce((count, row) => count + row.filter((value) => !isEmptyCell(value)).length, 0);
      const tables = extractTables(matrix, sheetName);
      const tableStartIndex = state.datasets.length;
      tables.forEach((table, tableIndex) => {
        const dataset = datasetProfile(table, sheetName, tableIndex, sourceFileName || fileName, sheetCurrencySymbol ?? currencySymbol);
        if (tables.length > 1) dataset.title = `${sheetName} · Table ${tableIndex + 1}`;
        state.datasets.push(dataset);
      });
      state.sheetReports.push({ sheetName, tableCount: state.datasets.length - tableStartIndex, cellCount: nonEmptyCells, firstDatasetIndex: tableStartIndex });
    });
    if (!state.datasets.length) {
      state.allRows = []; state.rows = []; state.columns = []; state.metrics = []; state.dimensions = [];
      $('source-name').textContent = state.workbookName;
      $('source-meta').textContent = `${state.workbookCount > 1 ? `${state.workbookCount} workbooks · ` : ''}${state.sheetReports.length} worksheets scanned · no clear tables detected`;
      $('dashboard-title').textContent = stripExtension(fileName) || 'Workbook overview';
      $('sidebar-dashboard-name').textContent = $('dashboard-title').textContent;
      renderWorkbookOverview();
      $('upload-modal').hidden = true;
      showToast(`Scanned ${state.sheetReports.length} worksheets. No structured tables were detected.`);
      return;
    }
    $('source-name').textContent = state.workbookName;
    $('source-meta').textContent = `${state.workbookCount > 1 ? `${state.workbookCount} workbooks · ` : ''}${state.sheetReports.length} worksheets scanned · ${state.datasets.length} tables found`;
    const bestIndex = state.datasets.reduce((best, dataset, index, all) => dataset.rankScore > all[best].rankScore ? index : best, 0);
    activateDataset(bestIndex);
    $('upload-modal').hidden = true;
    const structuredSheets = new Set(state.datasets.map((dataset) => dataset.sheetName)).size;
    showToast(`Scanned ${state.sheetReports.length} worksheets${state.workbookCount > 1 ? ` from ${state.workbookCount} workbooks` : ''} and built ${state.datasets.length} sheet view${state.datasets.length === 1 ? '' : 's'} across ${structuredSheets} worksheets.`);
  }

  function stripExtension(filename) { return String(filename || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(); }
  function updateFilterOptions() {
    const column = $('filter-column').value;
    const select = $('filter-value');
    select.replaceChildren(new Option('All values', ''));
    if (!column) { select.disabled = true; return; }
    const counts = new Map();
    state.allRows.forEach((row) => { const value = String(row[column] ?? '').trim(); if (value) counts.set(value, (counts.get(value) || 0) + 1); });
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 500).forEach(([value]) => select.add(new Option(value, value)));
    select.disabled = false;
  }
  function applyFilters() {
    const column = $('filter-column').value;
    const value = $('filter-value').value;
    state.filters = column && value ? { [column]: value } : {};
    $('clear-filter').disabled = Object.keys(state.filters).length === 0;
    state.rows = state.allRows.filter((row) => Object.entries(state.filters).every(([key, filterValue]) => String(row[key]) === filterValue));
    renderDashboard();
  }
  function selectOptions(select, values, selected, labelFor = (value) => value) {
    const old = selected || select.value;
    select.replaceChildren(...values.map((value) => new Option(labelFor(value), value)));
    if (values.includes(old)) select.value = old;
  }

  function aggregatedData(rows, dimension, metric, sort = false) {
    if (!dimension) return [{ key: 'All records', label: 'All records', value: sumMetric(rows, metric) }];
    const groups = new Map();
    rows.forEach((row) => {
      const raw = row[dimension];
      const date = dimension === state.dateColumn ? parseDate(raw) : null;
      const periodLabel = dimension === state.periodColumn;
      const key = date ? (periodLabel ? String(raw).trim() : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`) : String(raw ?? 'Unknown').trim() || 'Unknown';
      const label = date ? (periodLabel ? String(raw).trim() : date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })) : key;
      const value = metric && state.columns.includes(metric) ? toNumber(row[metric]) : 1;
      const current = groups.get(key) || { key, label, value: 0, sortValue: date?.getTime() ?? null };
      current.value += Number.isFinite(value) ? value : 0;
      groups.set(key, current);
    });
    const result = [...groups.values()];
    if (dimension === state.dateColumn) result.sort((a, b) => (a.sortValue ?? Number.MAX_SAFE_INTEGER) - (b.sortValue ?? Number.MAX_SAFE_INTEGER) || a.key.localeCompare(b.key, undefined, { numeric: true }));
    else if (sort) result.sort((a, b) => b.value - a.value);
    return result;
  }

  function chartYAxis(value, metric) {
    if (/revenue|sales|amount|profit|price|cost|income|value|total/i.test(metric || '')) return `${state.currencySymbol}${compact(value)}`;
    return compact(value);
  }
  function renderMainChart() {
    const metric = $('main-metric').value || state.metric;
    const dimension = $('main-dimension').value || state.dimension;
    const type = $('main-chart-type').value || state.mainType;
    state.metric = metric;
    state.dimension = dimension;
    state.mainType = type;
    const grouped = aggregatedData(state.rows, dimension, metric);
    const data = dimension === state.dateColumn ? grouped : [...grouped].sort((a, b) => b.value - a.value).slice(0, 24);
    const heading = state.mainTitle || (dimension === state.dateColumn ? `${metric || 'Records'} over time` : `${metric || 'Records'} by ${dimension || 'group'}`);
    $('main-chart-heading').textContent = heading;
    $('main-chart-subtitle').textContent = state.rows.length === state.allRows.length ? 'Track your performance across the period' : `Filtered to ${state.rows.length.toLocaleString()} matching rows`;
    $('main-chart-legend').textContent = metric || 'Records';
    $('period-note').textContent = dimension === state.dateColumn ? `By ${dimension}` : `By ${dimension || 'all records'}`;
    $('main-chart').setAttribute('aria-label', `${heading} ${type} chart`);
    const total = sumMetric(state.rows, metric);
    $('chart-total').textContent = metricFormat(total, metric);
    const half = Math.floor(data.length / 2);
    const first = data.slice(0, half || 1).reduce((sum, item) => sum + item.value, 0);
    const second = data.slice(half || 1).reduce((sum, item) => sum + item.value, 0);
    const change = first ? ((second - first) / Math.abs(first)) * 100 : 0;
    const delta = $('chart-delta');
    delta.textContent = dimension === state.dateColumn && data.length > 1 ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}%` : `${grouped.length} groups`;
    delta.classList.toggle('down', dimension === state.dateColumn && change < 0);
    document.querySelector('.summary-caption').textContent = dimension === state.dateColumn ? 'in selected period' : 'in this view';

    const width = 720, height = 200, left = 48, right = 8, top = 10, bottom = 29;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const values = data.map((item) => item.value);
    const maxValue = Math.max(1, ...values);
    const niceMax = maxValue * 1.12;
    const count = Math.max(data.length, 1);
    const x = (index) => left + (count === 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);
    const y = (value) => top + plotHeight - (value / niceMax) * plotHeight;
    const grid = Array.from({ length: 4 }, (_, index) => {
      const v = (niceMax * (3 - index)) / 3;
      const yy = top + (index / 3) * plotHeight;
      return `<line class="grid-line" x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" stroke="#eef0f5" stroke-width="1"/><text x="${left - 8}" y="${yy + 3}" text-anchor="end" fill="#a6aab8" font-size="8" font-family="DM Sans">${escapeXml(chartYAxis(v, metric))}</text>`;
    }).join('');
    const labelStep = Math.max(1, Math.ceil(data.length / 7));
    const labels = data.map((item, index) => index % labelStep === 0 || index === data.length - 1
      ? `<text x="${x(index)}" y="${height - 7}" text-anchor="middle" fill="#a6aab8" font-size="8" font-family="DM Sans">${escapeXml(shortLabel(item.label, 12))}</text>` : '').join('');
    let series = '';
    if (type === 'bar') {
      const step = plotWidth / count;
      const barWidth = Math.max(3, Math.min(30, step * .53));
      series = data.map((item, index) => `<rect x="${x(index) - barWidth / 2}" y="${y(item.value)}" width="${barWidth}" height="${Math.max(0, top + plotHeight - y(item.value))}" rx="3" fill="#8a7aeb"><title>${escapeXml(item.label)}: ${escapeXml(metricFormat(item.value, metric))}</title></rect>`).join('');
    } else {
      const points = data.map((item, index) => `${x(index)},${y(item.value)}`).join(' ');
      const area = `${left},${top + plotHeight} ${points} ${x(Math.max(data.length - 1, 0))},${top + plotHeight}`;
      series = `${type === 'area' ? `<defs><linearGradient id="main-area-gradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#9182f1" stop-opacity=".27"/><stop offset="100%" stop-color="#9182f1" stop-opacity=".015"/></linearGradient></defs><polygon points="${area}" fill="url(#main-area-gradient)"/>` : ''}<polyline points="${points}" fill="none" stroke="#8878eb" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${data.map((item, index) => `<circle cx="${x(index)}" cy="${y(item.value)}" r="${data.length > 22 ? 2.2 : 3}" fill="#fff" stroke="#8878eb" stroke-width="2"><title>${escapeXml(item.label)}: ${escapeXml(metricFormat(item.value, metric))}</title></circle>`).join('')}`;
    }
    $('main-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeXml(heading)}">${grid}${series}${labels}</svg>`;
  }

  function renderBars(element, data, metric, limit = 5) {
    const width = 440, height = 180, left = 112, right = 45, top = 3, rowHeight = 32;
    const shown = [...data].sort((a, b) => b.value - a.value).slice(0, limit);
    if (!shown.length) { element.innerHTML = '<div class="empty-chart">No values available</div>'; return; }
    const max = Math.max(1, ...shown.map((item) => item.value));
    const rows = shown.map((item, index) => {
      const y = top + index * rowHeight;
      const barWidth = Math.max(1, (item.value / max) * (width - left - right));
      return `<text x="${left - 9}" y="${y + 14}" text-anchor="end" fill="#83889a" font-size="9" font-family="DM Sans">${escapeXml(shortLabel(item.label, 17))}</text><rect x="${left}" y="${y + 4}" width="${width - left - right}" height="9" rx="4.5" fill="#f1f1f7"/><rect x="${left}" y="${y + 4}" width="${barWidth}" height="9" rx="4.5" fill="${palette[index % palette.length]}"><title>${escapeXml(item.label)}: ${escapeXml(metricFormat(item.value, metric))}</title></rect><text x="${width - right + 6}" y="${y + 13}" fill="#555a6f" font-size="8" font-family="DM Sans">${escapeXml(metricFormat(item.value, metric, true))}</text>`;
    }).join('');
    element.innerHTML = `<svg viewBox="0 0 ${width} ${Math.max(height, top + shown.length * rowHeight)}" preserveAspectRatio="none" role="img">${rows}</svg>`;
  }
  function renderMiniLine(element, data, metric) {
    const shown = data.slice(-14);
    if (!shown.length) { element.innerHTML = '<div class="empty-chart">No values available</div>'; return; }
    const width = 440, height = 178, left = 35, right = 5, top = 10, bottom = 25;
    const max = Math.max(1, ...shown.map((item) => item.value)) * 1.08;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const x = (index) => left + (shown.length === 1 ? plotWidth / 2 : index * plotWidth / (shown.length - 1));
    const y = (value) => top + plotHeight - (value / max) * plotHeight;
    const points = shown.map((item, index) => `${x(index)},${y(item.value)}`).join(' ');
    const step = Math.max(1, Math.ceil(shown.length / 5));
    const labels = shown.map((item, index) => index % step === 0 || index === shown.length - 1 ? `<text x="${x(index)}" y="${height - 5}" text-anchor="middle" fill="#a6aab8" font-size="8" font-family="DM Sans">${escapeXml(shortLabel(item.label, 10))}</text>` : '').join('');
    const grid = [0, 1, 2].map((index) => {
      const yy = top + (index / 2) * plotHeight;
      return `<line class="grid-line" x1="${left}" y1="${yy}" x2="${width}" y2="${yy}" stroke="#eef0f5"/><text x="${left - 5}" y="${yy + 3}" text-anchor="end" fill="#a6aab8" font-size="7" font-family="DM Sans">${escapeXml(chartYAxis(max * (1 - index / 2), metric))}</text>`;
    }).join('');
    element.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">${grid}<polyline points="${points}" fill="none" stroke="#8878eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${shown.map((item, index) => `<circle cx="${x(index)}" cy="${y(item.value)}" r="3" fill="white" stroke="#8878eb" stroke-width="2"><title>${escapeXml(item.label)}: ${escapeXml(metricFormat(item.value, metric))}</title></circle>`).join('')}${labels}</svg>`;
  }
  function renderDonut(element, legend, data, metric) {
    const shown = [...data].sort((a, b) => b.value - a.value).slice(0, 6);
    if (!shown.length) { element.innerHTML = '<div class="empty-chart">No values available</div>'; legend.innerHTML = ''; return; }
    const total = shown.reduce((sum, item) => sum + item.value, 0) || 1;
    const radius = 54, circumference = 2 * Math.PI * radius;
    let offset = 0;
    const circles = shown.map((item, index) => {
      const portion = Math.max(0, (item.value / total) * circumference);
      const circle = `<circle cx="90" cy="85" r="${radius}" fill="none" stroke="${palette[index % palette.length]}" stroke-width="20" stroke-dasharray="${portion} ${circumference - portion}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 85)"><title>${escapeXml(item.label)}: ${escapeXml(metricFormat(item.value, metric))}</title></circle>`;
      offset += portion;
      return circle;
    }).join('');
    element.innerHTML = `<svg viewBox="0 0 180 170" role="img" aria-label="Share by category"><circle cx="90" cy="85" r="${radius}" fill="none" stroke="#f1f1f6" stroke-width="20"/>${circles}<text x="90" y="82" text-anchor="middle" fill="#373b52" font-family="Manrope" font-size="16" font-weight="700">${escapeXml(compact(total))}</text><text x="90" y="98" text-anchor="middle" fill="#a0a4b2" font-family="DM Sans" font-size="8">total</text></svg>`;
    legend.innerHTML = shown.map((item, index) => `<div class="legend-row"><span class="legend-swatch" style="background:${palette[index % palette.length]}"></span><span>${escapeHTML(shortLabel(item.label, 13))}</span><span class="legend-value">${((item.value / total) * 100).toFixed(0)}%</span></div>`).join('');
  }

  function semanticMetric(pattern, fallback = '') { return state.metrics.find((metric) => pattern.test(metric)) || fallback; }
  function renderKpis() {
    const revenue = semanticMetric(/revenue|sales|amount|total|gross|net/i, state.metric);
    const orders = semanticMetric(/orders?|transactions?|quantity|qty|units|count/i, '');
    const profit = semanticMetric(/profit|income/i, '');
    const revenueTotal = sumMetric(state.rows, revenue);
    const orderTotal = orders ? sumMetric(state.rows, orders) : state.rows.length;
    const profitTotal = profit ? sumMetric(state.rows, profit) : 0;
    const average = orderTotal ? revenueTotal / orderTotal : 0;
    const margin = revenueTotal ? profitTotal / revenueTotal : 0;
    const items = [
      { label: revenue || 'Records', value: revenue ? metricFormat(revenueTotal, revenue) : compact(state.rows.length), meta: `${state.rows.length.toLocaleString()} rows in this view`, icon: '↗', change: 'Live' },
      { label: orders || 'Rows analyzed', value: compact(orderTotal, 0), meta: orders ? `Total ${orders.toLowerCase()}` : 'Included in this view', icon: '▤', change: 'Live' },
      { label: revenue ? 'Average per order' : 'Columns found', value: revenue ? metricFormat(average, revenue) : String(state.columns.length), meta: revenue ? 'Based on available order count' : 'Detected from your sheet', icon: '◌', change: 'Live' },
      { label: profit ? 'Profit margin' : 'Categories', value: profit ? `${(margin * 100).toFixed(1)}%` : String(state.dimensions.length), meta: profit ? `${metricFormat(profitTotal, profit)} total profit` : 'Fields available to explore', icon: '⌁', change: profit ? (margin >= .2 ? 'Healthy' : 'Review') : 'Ready' },
    ];
    $('kpi-grid').innerHTML = items.map((item) => `<article class="kpi-card"><div class="kpi-label">${escapeHTML(item.label)}</div><span class="kpi-icon">${item.icon}</span><div class="kpi-value">${escapeHTML(item.value)}</div><div class="kpi-meta"><span class="kpi-change">${escapeHTML(item.change)}</span><span>${escapeHTML(item.meta)}</span></div></article>`).join('');
  }

  function renderInsights() {
    const metric = $('main-metric').value || state.metric;
    const dimension = state.categoryDimension || state.dimensions[0];
    const region = state.regionDimension;
    const items = [];
    const topCategory = dimension ? aggregatedData(state.rows, dimension, metric, true)[0] : null;
    if (topCategory) {
      const share = sumMetric(state.rows, metric) ? (topCategory.value / sumMetric(state.rows, metric)) * 100 : 0;
      items.push({ icon: '↗', text: `<strong>${escapeHTML(topCategory.label)}</strong> leads ${escapeHTML(dimension.toLowerCase())} with <strong>${escapeHTML(metricFormat(topCategory.value, metric))}</strong> — ${share.toFixed(0)}% of the total.` });
    }
    if (region && region !== dimension) {
      const topRegion = aggregatedData(state.rows, region, metric, true)[0];
      if (topRegion) items.push({ icon: '◎', text: `<strong>${escapeHTML(topRegion.label)}</strong> is your strongest ${escapeHTML(region.toLowerCase())}, contributing <strong>${escapeHTML(metricFormat(topRegion.value, metric))}</strong>.` });
    }
    if (state.dateColumn) {
      const trend = aggregatedData(state.rows, state.dateColumn, metric);
      if (trend.length > 1) {
        const first = trend[0].value, last = trend[trend.length - 1].value;
        const delta = first ? ((last - first) / Math.abs(first)) * 100 : 0;
        items.push({ icon: delta >= 0 ? '↗' : '⌁', text: `Latest period is <strong>${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)}%</strong> compared with ${escapeHTML(trend[0].label)}.` });
      }
    }
    if (!items.length) items.push({ icon: '✧', text: `Atlas found <strong>${state.rows.length.toLocaleString()} rows</strong> and ${state.columns.length} columns. Try grouping a metric by one of your fields.` });
    $('insight-list').innerHTML = items.slice(0, 3).map((item) => `<div class="insight-item"><span class="insight-icon">${item.icon}</span><div class="insight-text">${item.text}</div></div>`).join('');
  }

  function renderTable() {
    const dimension = state.categoryDimension || state.dimensions[0];
    const metric = $('main-metric').value || state.metric;
    const rows = dimension ? aggregatedData(state.rows, dimension, metric, true).slice(0, state.topN) : state.rows.slice(0, state.topN).map((row, index) => ({ label: `Row ${index + 1}`, value: metric ? toNumber(row[metric]) || 0 : 1, detail: row }));
    const total = sumMetric(state.rows, metric);
    $('table-metric-label').textContent = metric || 'records';
    $('table-head').innerHTML = `<tr><th>#</th><th>${escapeHTML(dimension || 'Record')}</th><th>${escapeHTML(metric || 'Value')}</th><th>Share</th></tr>`;
    const maximum = Math.max(1, ...rows.map((row) => row.value));
    $('table-body').innerHTML = rows.map((row, index) => {
      const pct = total ? (row.value / total) * 100 : 0;
      const bar = Math.max(2, (row.value / maximum) * 100);
      return `<tr><td><span class="rank-cell">${index + 1}</span></td><td>${escapeHTML(row.label)}</td><td>${escapeHTML(metricFormat(row.value, metric))}</td><td>${pct.toFixed(1)}% <span class="table-bar"><i style="width:${bar}%"></i></span></td></tr>`;
    }).join('');
    $('row-count').textContent = `Showing ${rows.length} of ${state.rows.length.toLocaleString()} groups`;
  }

  function renderExtraCharts() {
    const host = $('extra-charts');
    host.innerHTML = state.extraCharts.map((chart, index) => `<article class="panel extra-chart-panel" data-extra-index="${index}"><div class="panel-header"><div><div class="panel-overline">CUSTOM VISUALIZATION</div><h2>Chart ${index + 1}</h2></div><div class="extra-controls"><select data-extra-metric="${index}" aria-label="Choose metric for chart ${index + 1}"></select><select data-extra-dimension="${index}" aria-label="Choose grouping for chart ${index + 1}"></select><select data-extra-type="${index}" aria-label="Choose type for chart ${index + 1}"><option value="bar">Bar</option><option value="line">Line</option></select><button class="icon-button remove-extra" data-remove-extra="${index}" aria-label="Remove chart ${index + 1}">×</button></div></div><div class="mini-chart-area extra-chart-body" id="extra-chart-${index}"></div></article>`).join('');
    state.extraCharts.forEach((chart, index) => {
      const metricSelect = host.querySelector(`[data-extra-metric="${index}"]`);
      const dimensionSelect = host.querySelector(`[data-extra-dimension="${index}"]`);
      const typeSelect = host.querySelector(`[data-extra-type="${index}"]`);
      selectOptions(metricSelect, state.metrics.length ? state.metrics : ['Records'], chart.metric);
      selectOptions(dimensionSelect, [state.dateColumn, ...state.dimensions].filter(Boolean), chart.dimension);
      typeSelect.value = chart.type;
      const data = aggregatedData(state.rows, chart.dimension, chart.metric);
      if (chart.type === 'line') renderMiniLine($(`extra-chart-${index}`), data, chart.metric);
      else renderBars($(`extra-chart-${index}`), data, chart.metric, 6);
    });
  }

  function renderDashboard() {
    if (!state.allRows.length) return;
    const metrics = state.metrics.length ? state.metrics : ['Records'];
    const dimensions = [...(state.dateColumn ? [state.dateColumn] : []), ...state.dimensions];
    selectOptions($('main-metric'), metrics, state.metric);
    selectOptions($('main-dimension'), dimensions.length ? dimensions : [''], state.dimension, (value) => value || 'All records');
    if (!$('main-chart-type').value) $('main-chart-type').value = state.mainType;
    const catData = state.categoryDimension ? aggregatedData(state.rows, state.categoryDimension, $('main-metric').value, true) : [];
    const regionData = state.regionDimension ? aggregatedData(state.rows, state.regionDimension, $('main-metric').value, true) : catData;
    $('category-chart-heading').textContent = `${$('main-metric').value || 'Records'} by ${state.categoryDimension || 'group'}`;
    $('region-chart-heading').textContent = `${$('main-metric').value || 'Records'} by ${state.regionDimension || state.categoryDimension || 'group'}`;
    $('category-footnote').textContent = state.categoryDimension ? `By ${state.categoryDimension}` : 'Add a categorical field to see a breakdown';
    renderKpis();
    renderMainChart();
    renderBars($('category-chart'), catData, $('main-metric').value, 5);
    renderDonut($('region-chart'), $('region-legend'), regionData, $('main-metric').value);
    renderInsights();
    renderTable();
    renderExtraCharts();
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [], value = '', quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else value += char;
      } else if (char === '"') quoted = true;
      else if (char === delimiter) { row.push(value); value = ''; }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        row.push(value); value = '';
        if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
        row = [];
      } else value += char;
    }
    row.push(value);
    if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
    return rows;
  }
  function showUploadError(message) {
    $('upload-error').textContent = message;
    $('upload-error').hidden = false;
  }
  function detectCurrency(workbook, matrices = []) {
    const detect = (text) => {
      const value = String(text || '');
      if (/₹|INR|Rs\.?\s/i.test(value)) return '₹';
      if (/€/i.test(value)) return '€';
      if (/£/i.test(value)) return '£';
      if (/¥/i.test(value)) return '¥';
      if (/\$/.test(value)) return '$';
      return '';
    };
    for (const sheetName of workbook?.SheetNames || []) {
      const sheet = workbook.Sheets[sheetName];
      const range = sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
      if (!range) continue;
      for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 80); row += 1) {
        for (let column = range.s.c; column <= Math.min(range.e.c, range.s.c + 40); column += 1) {
          const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
          const found = detect(`${cell?.w || ''} ${cell?.z || ''}`);
          if (found) return found;
        }
      }
    }
    for (const { matrix } of matrices) {
      for (const row of matrix.slice(0, 60)) {
        for (const value of row) { const found = detect(value); if (found) return found; }
      }
    }
    return '';
  }
  async function processFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    $('upload-error').hidden = true;
    $('scan-status').hidden = false;
    $('scan-status-text').textContent = `Preparing ${files.length} file${files.length === 1 ? '' : 's'}…`;
    const oversized = files.find((file) => file.size > 20 * 1024 * 1024);
    if (oversized) {
      $('scan-status').hidden = true;
      showUploadError(`${oversized.name} is larger than 20 MB. Try a smaller sheet or export a smaller range as CSV.`);
      return;
    }
    const sheetMatrices = [];
    const failures = [];
    const filenameCounts = new Map();
    const fileLabels = files.map((file) => {
      const base = stripExtension(file.name);
      const count = (filenameCounts.get(base) || 0) + 1;
      filenameCounts.set(base, count);
      return count === 1 ? base : `${base} (${count})`;
    });
    try {
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        const extension = file.name.split('.').pop().toLowerCase();
        $('scan-status-text').textContent = `Reading file ${fileIndex + 1} of ${files.length}: ${file.name}`;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        try {
          if (extension === 'csv' || extension === 'tsv') {
            const text = await file.text();
            const firstLine = text.split('\n', 1)[0];
            const delimiter = extension === 'tsv' ? '\t' : (firstLine.match(/,/g) || []).length >= (firstLine.match(/\t/g) || []).length ? ',' : '\t';
            const matrix = parseDelimited(text.replace(/^\uFEFF/, ''), delimiter).map((row) => row.map(cleanCell));
            sheetMatrices.push({
              sheetName: files.length > 1 ? `${fileLabels[fileIndex]} · Data` : stripExtension(file.name),
              sourceFileName: file.name,
              sourceFileIndex: fileIndex,
              sheetCurrencySymbol: detectCurrency(null, [{ matrix }]),
              matrix,
            });
            continue;
          }
          if (!['xlsx', 'xls', 'xlsm'].includes(extension)) throw new Error('Unsupported file type. Choose an Excel, CSV, or TSV file.');
          if (!window.XLSX) throw new Error('Excel support is still loading. Check your internet connection and try again.');
          const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, cellNF: true });
          if (!workbook.SheetNames.length) throw new Error('No worksheets were found in this workbook.');
          const matrices = workbook.SheetNames.map((sheetName) => ({
            sheetName: files.length > 1 ? `${fileLabels[fileIndex]} · ${sheetName}` : sheetName,
            sourceFileName: file.name,
            sourceFileIndex: fileIndex,
            matrix: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true, blankrows: true }),
          }));
          const fileCurrencySymbol = detectCurrency(workbook, matrices);
          matrices.forEach((sheet) => { sheet.sheetCurrencySymbol = fileCurrencySymbol; });
          sheetMatrices.push(...matrices);
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : 'could not be read'}`);
        }
      }
      if (!sheetMatrices.length) {
        showUploadError(failures[0] || 'I could not read those files. Try saving them as .xlsx or .csv.');
        return;
      }
      const loadedFileIndexes = [...new Set(sheetMatrices.map((sheet) => sheet.sourceFileIndex))];
      const sourceLabel = loadedFileIndexes.length === 1 ? files[loadedFileIndexes[0]].name : `${loadedFileIndexes.length} workbooks`;
      loadWorkbookMatrices(sheetMatrices, sourceLabel, '', loadedFileIndexes.length);
      if (failures.length) showToast(`Loaded ${loadedFileIndexes.length} of ${files.length} files. ${failures[0]}`);
    } catch (error) {
      showUploadError(error instanceof Error ? error.message : 'I could not read those files. Try saving them as .xlsx or .csv.');
    } finally {
      $('scan-status').hidden = true;
    }
  }

  function findNamedField(query, fields) {
    const lower = query.toLowerCase();
    return [...fields].sort((a, b) => b.length - a.length).find((field) => lower.includes(field.toLowerCase())) || '';
  }
  function findNamedValue(query) {
    const candidates = [];
    state.dimensions.forEach((column) => unique(state.allRows.map((row) => row[column])).forEach((value) => candidates.push({ column, value })));
    return candidates.sort((a, b) => String(b.value).length - String(a.value).length).find((candidate) => query.toLowerCase().includes(String(candidate.value).toLowerCase())) || null;
  }
  function summarizeCurrentData() {
    const metric = $('main-metric').value || state.metric;
    const total = sumMetric(state.rows, metric);
    const dimension = state.categoryDimension || state.dimensions[0];
    const top = dimension ? aggregatedData(state.rows, dimension, metric, true)[0] : null;
    const dateData = state.dateColumn ? aggregatedData(state.rows, state.dateColumn, metric) : [];
    const trendText = dateData.length > 1 ? (() => {
      const first = dateData[0].value, last = dateData[dateData.length - 1].value;
      const change = first ? ((last - first) / Math.abs(first)) * 100 : 0;
      return ` The latest period is ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}% versus the first.`;
    })() : '';
    return `I looked across ${state.rows.length.toLocaleString()} rows. Total ${metric || 'records'} is ${metricFormat(total, metric)}${top ? `, with ${top.label} leading ${dimension} at ${metricFormat(top.value, metric)}` : ''}.${trendText} The dashboard has been refreshed with those patterns.`;
  }
  function aiContext() {
    return {
      rowCount: state.rows.length,
      workbookCount: state.workbookCount,
      detectedTableCount: state.datasets.length,
      fields: state.columns.slice(0, 100).map((name) => ({
        name,
        type: name === state.dateColumn ? 'date' : state.metrics.includes(name) ? 'numeric' : state.dimensions.includes(name) ? 'category' : 'other',
      })),
      availableMetrics: state.metrics.slice(0, 50),
      availableDimensions: [...new Set([...(state.dateColumn ? [state.dateColumn] : []), ...state.dimensions])].slice(0, 50),
      currentChart: {
        metric: $('main-metric').value || state.metric,
        dimension: $('main-dimension').value || state.dimension,
        type: $('main-chart-type').value,
      },
    };
  }
  function applyAIResult(result) {
    const action = result?.action;
    const allowedTypes = ['line', 'bar', 'area'];
    if (action === 'set_chart') {
      const metric = state.metrics.includes(result.metric) ? result.metric : '';
      const dimensions = [...new Set([...(state.dateColumn ? [state.dateColumn] : []), ...state.dimensions])];
      const dimension = dimensions.includes(result.dimension) ? result.dimension : '';
      if (metric) $('main-metric').value = metric;
      if (dimension) { $('main-dimension').value = dimension; state.categoryDimension = dimension; }
      if (allowedTypes.includes(result.chartType)) $('main-chart-type').value = result.chartType;
      state.metric = $('main-metric').value;
      state.dimension = $('main-dimension').value;
      renderDashboard();
      setResponse(result.message || 'Updated the dashboard based on your instruction.');
      return;
    }
    if (action === 'filter') {
      const column = state.dimensions.includes(result.filterColumn) ? result.filterColumn : '';
      const value = String(result.filterValue ?? '');
      const exists = column && state.allRows.some((row) => String(row[column] ?? '').trim() === value);
      if (!exists) { setResponse('I couldn’t match that filter to a value in the current data. Choose a field and value from the filter bar.'); return; }
      $('filter-column').value = column;
      updateFilterOptions();
      $('filter-value').value = value;
      applyFilters();
      setResponse(result.message || `Filtered ${column} to “${value}”.`);
      return;
    }
    if (action === 'set_title' && typeof result.title === 'string' && result.title.trim()) {
      state.dashboardTitle = result.title.trim().slice(0, 90);
      $('dashboard-title').textContent = state.dashboardTitle;
      $('sidebar-dashboard-name').textContent = state.dashboardTitle;
      setResponse(result.message || `Renamed the dashboard to “${state.dashboardTitle}”.`);
      return;
    }
    if (action === 'set_theme' && ['dark', 'light'].includes(result.theme)) {
      document.body.classList.toggle('dark', result.theme === 'dark');
      setResponse(result.message || `Switched to ${result.theme} mode.`);
      return;
    }
    if (action === 'add_chart') { addChart(); setResponse(result.message || 'Added a chart. Choose its fields with the controls.'); return; }
    if (action === 'remove_chart') {
      if (state.extraCharts.length) { state.extraCharts.pop(); renderExtraCharts(); setResponse(result.message || 'Removed the last custom chart.'); }
      else setResponse('There are no custom charts to remove yet.');
      return;
    }
    if (action === 'show_insights' || action === 'hide_insights') {
      $('insights-panel').hidden = action === 'hide_insights';
      setResponse(result.message || (action === 'show_insights' ? 'The insights panel is back.' : 'The insights panel is hidden.'));
      return;
    }
    setResponse(typeof result?.message === 'string' && result.message.trim() ? result.message.trim() : 'I couldn’t map that request to a dashboard change. Try naming a metric, a grouping, or a chart style.');
  }
  async function askAI(prompt) {
    setResponse('Thinking through your request…');
    try {
      const response = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, context: aiContext() }),
        signal: AbortSignal.timeout(25000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'AI is unavailable right now.');
      applyAIResult(payload.result);
    } catch (error) {
      const reason = error.name === 'TimeoutError' ? 'The AI request timed out.' : error.message;
      setResponse(`${reason} The workbook is still in your browser; local dashboard controls continue to work.`);
    }
  }
  function handlePrompt(prompt) {
    const text = prompt.trim();
    if (!text) return;
    const lower = text.toLowerCase();
    const response = $('assistant-response');
    response.hidden = true;

    if (/all sheets|workbook overview|overview of (the )?workbook|show every sheet/.test(lower)) {
      renderWorkbookOverview();
      return;
    }
    const openSheet = lower.match(/(?:open|switch to|go to|analyze|analyse)\s+(?:the\s+)?(?:sheet\s+)?(.+)/i);
    if (openSheet?.[1]) {
      const query = openSheet[1].trim().replace(/["']/g, '');
      const targetIndex = state.datasets.findIndex((dataset) => dataset.title.toLowerCase() === query || dataset.sheetName.toLowerCase() === query || dataset.title.toLowerCase().includes(query));
      if (targetIndex >= 0) { activateDataset(targetIndex); setResponse(`Opened the ${state.datasets[targetIndex].title} view.`); }
      else setResponse(`I couldn’t find a worksheet or table called “${query}”. Open All sheets to see the scanned workbook.`);
      return;
    }
    if (/clear (all )?filters?|reset filters?|remove filter/.test(lower)) {
      $('filter-column').value = '';
      updateFilterOptions();
      $('filter-value').value = '';
      applyFilters();
      setResponse('Filters cleared. You’re looking at all rows again.');
      return;
    }
    if (/dark mode|make it dark|dark theme/.test(lower)) {
      document.body.classList.add('dark'); setResponse('Dark mode is on.'); return;
    }
    if (/light mode|make it light|light theme/.test(lower)) {
      document.body.classList.remove('dark'); setResponse('Light mode is on.'); return;
    }
    if (/hide (the )?insights?|hide what.?s moving/.test(lower)) {
      $('insights-panel').hidden = true; setResponse('The insights panel is hidden.'); return;
    }
    if (/show (the )?insights?|bring back insights?/.test(lower)) {
      $('insights-panel').hidden = false; setResponse('The insights panel is back.'); return;
    }
    const dashboardRename = text.match(/(?:rename|title|call) (?:the )?(?:dashboard|this dashboard)(?: to| as)?\s+(.+)/i);
    if (dashboardRename?.[1]) {
      state.dashboardTitle = dashboardRename[1].replace(/["']/g, '').trim();
      $('dashboard-title').textContent = state.dashboardTitle;
      $('sidebar-dashboard-name').textContent = state.dashboardTitle;
      setResponse(`Dashboard renamed to “${state.dashboardTitle}”.`); return;
    }
    const chartRename = text.match(/(?:rename|title|call) (?:the )?(?:main )?chart(?: to| as)?\s+(.+)/i);
    if (chartRename?.[1]) {
      state.mainTitle = chartRename[1].replace(/["']/g, '').trim(); renderMainChart();
      setResponse(`Main chart renamed to “${state.mainTitle}”.`); return;
    }
    if (/bar chart|bars|column chart/.test(lower)) { $('main-chart-type').value = 'bar'; renderMainChart(); setResponse('Switched the main visualization to bars.'); return; }
    if (/area chart|filled area/.test(lower)) { $('main-chart-type').value = 'area'; renderMainChart(); setResponse('Switched the main visualization to an area chart.'); return; }
    if (/line chart|lines|trend line/.test(lower)) { $('main-chart-type').value = 'line'; renderMainChart(); setResponse('Switched the main visualization to a line chart.'); return; }
    if (/top\s+\d+/.test(lower)) {
      state.topN = Math.max(1, Math.min(20, Number(lower.match(/top\s+(\d+)/)[1])));
      renderTable(); setResponse(`The performers table now shows the top ${state.topN}.`); return;
    }
    if (/filter|only show|show only|just show|limit to/.test(lower)) {
      const match = findNamedValue(lower);
      if (match) {
        $('filter-column').value = match.column;
        updateFilterOptions();
        $('filter-value').value = match.value;
        applyFilters();
        setResponse(`Filtered ${match.column} to “${match.value}”. You can clear it from the filter bar.`);
      } else { askAI(text); }
      return;
    }
    const namedMetric = findNamedField(lower, state.metrics);
    const namedDimension = findNamedField(lower, [...(state.dateColumn ? [state.dateColumn] : []), ...state.dimensions]);
    if (namedMetric && namedDimension && (/\bby\b|group|breakdown|against/.test(lower))) {
      $('main-metric').value = namedMetric;
      $('main-dimension').value = namedDimension;
      state.categoryDimension = namedDimension;
      renderDashboard();
      setResponse(`Now showing ${namedMetric} by ${namedDimension}. You can adjust the metric, grouping, and chart style above the chart.`);
      return;
    }
    if (namedMetric && /metric|show|plot|chart|compare/.test(lower)) {
      $('main-metric').value = namedMetric; renderDashboard(); setResponse(`The dashboard is now focused on ${namedMetric}.`); return;
    }
    if (/add (a )?(new )?chart|another chart|new visualization/.test(lower)) { addChart(); setResponse('Added a chart. Use its selectors to choose the metric, grouping, and style.'); return; }
    if (/remove (the )?(last )?chart|delete chart/.test(lower)) {
      if (state.extraCharts.length) { state.extraCharts.pop(); renderExtraCharts(); setResponse('Removed the last custom chart.'); }
      else setResponse('There are no custom charts to remove yet. Add one with the button above.');
      return;
    }
    if (/what stands out|summari[sz]e|insight|analy[sz]e|tell me about|what do you see|overview/.test(lower)) { setResponse(summarizeCurrentData()); return; }
    askAI(text);
  }

  function addChart() {
    state.extraCharts.push({ metric: state.metric || state.metrics[0] || '', dimension: state.categoryDimension || state.dimensions[0] || state.dateColumn, type: 'bar' });
    renderExtraCharts();
    $('extra-charts').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function downloadRows(rows, filename) {
    if (!rows.length) { showToast('There are no rows to export in this view.'); return; }
    const headers = state.columns;
    const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.map(escapeCell).join(','), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(','))].join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(`Exported ${rows.length.toLocaleString()} rows.`);
  }

  function bindEvents() {
    $('upload-button').addEventListener('click', () => { $('upload-modal').hidden = false; $('upload-error').hidden = true; });
    $('sidebar-ask').addEventListener('click', () => {
      if (!state.datasets.length) { $('upload-modal').hidden = false; return; }
      if (state.activeDatasetIndex < 0 && state.datasets.length) {
        const bestIndex = state.datasets.reduce((best, dataset, index, all) => dataset.rankScore > all[best].rankScore ? index : best, 0);
        activateDataset(bestIndex);
      }
      $('prompt-input').focus(); $('prompt-input').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('new-dashboard').addEventListener('click', () => { $('upload-modal').hidden = false; });
    $('empty-upload-button').addEventListener('click', () => { $('upload-modal').hidden = false; $('upload-error').hidden = true; });
    $('close-upload').addEventListener('click', () => { $('upload-modal').hidden = true; });
    $('upload-modal').addEventListener('click', (event) => { if (event.target === $('upload-modal')) $('upload-modal').hidden = true; });
    $('browse-files').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', (event) => { const files = Array.from(event.target.files || []); event.target.value = ''; processFiles(files); });
    $('drop-zone').addEventListener('click', (event) => { if (event.target.id !== 'browse-files') $('file-input').click(); });
    $('drop-zone').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('file-input').click(); } });
    ['dragenter', 'dragover'].forEach((name) => $('drop-zone').addEventListener(name, (event) => { event.preventDefault(); $('drop-zone').classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach((name) => $('drop-zone').addEventListener(name, (event) => { event.preventDefault(); $('drop-zone').classList.remove('drag-over'); }));
    $('drop-zone').addEventListener('drop', (event) => processFiles(event.dataTransfer.files));
    $('sheet-nav').addEventListener('click', (event) => {
      const overview = event.target.closest('[data-overview]');
      if (overview) { renderWorkbookOverview(); return; }
      const tab = event.target.closest('[data-dataset-index]');
      if (tab) activateDataset(Number(tab.dataset.datasetIndex));
    });
    $('overview-cards').addEventListener('click', (event) => {
      const card = event.target.closest('[data-open-dataset]');
      if (card) activateDataset(Number(card.dataset.openDataset));
    });
    $('filter-column').addEventListener('change', () => { updateFilterOptions(); $('filter-value').value = ''; applyFilters(); });
    $('filter-value').addEventListener('change', applyFilters);
    $('clear-filter').addEventListener('click', () => { $('filter-column').value = ''; updateFilterOptions(); $('filter-value').value = ''; applyFilters(); });
    $('main-metric').addEventListener('change', () => { state.metric = $('main-metric').value; renderDashboard(); });
    $('main-dimension').addEventListener('change', () => { state.dimension = $('main-dimension').value; renderDashboard(); });
    $('main-chart-type').addEventListener('change', renderMainChart);
    $('prompt-form').addEventListener('submit', (event) => { event.preventDefault(); handlePrompt($('prompt-input').value); $('prompt-input').value = ''; });
    $('suggestions').addEventListener('click', (event) => { const button = event.target.closest('[data-prompt]'); if (button) handlePrompt(button.dataset.prompt); });
    $('refresh-insights').addEventListener('click', () => { renderInsights(); showToast('Insights refreshed using the current view.'); });
    $('theme-toggle').addEventListener('click', () => {
      document.body.classList.toggle('dark');
      syncThemeControl();
      try { localStorage.setItem('atlas-theme', document.body.classList.contains('dark') ? 'dark' : 'light'); } catch { /* Private browsing can disable storage. */ }
    });
    $('add-chart').addEventListener('click', addChart);
    $('export-button').addEventListener('click', () => downloadRows(state.rows, `${stripExtension(state.fileName) || 'atlas'}-data.csv`));
    $('table-download').addEventListener('click', () => downloadRows(state.rows, `${stripExtension(state.fileName) || 'atlas'}-data.csv`));
    $('share-button').addEventListener('click', () => showToast('This dashboard is running privately in your browser. Export the data to share it.'));
    $('data-menu').addEventListener('click', () => { $('upload-modal').hidden = false; });
    $('extra-charts').addEventListener('change', (event) => {
      const target = event.target;
      const index = Number(target.dataset.extraMetric ?? target.dataset.extraDimension ?? target.dataset.extraType);
      if (!Number.isInteger(index) || !state.extraCharts[index]) return;
      if (target.dataset.extraMetric != null) state.extraCharts[index].metric = target.value;
      if (target.dataset.extraDimension != null) state.extraCharts[index].dimension = target.value;
      if (target.dataset.extraType != null) state.extraCharts[index].type = target.value;
      renderExtraCharts();
    });
    $('extra-charts').addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-extra]');
      if (!button) return;
      state.extraCharts.splice(Number(button.dataset.removeExtra), 1);
      renderExtraCharts();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') $('upload-modal').hidden = true; });
  }

  bindEvents();
  const savedTheme = (() => { try { return localStorage.getItem('atlas-theme'); } catch { return ''; } })();
  if (savedTheme === 'dark') document.body.classList.add('dark');
  syncThemeControl();

  function syncThemeControl() {
    const dark = document.body.classList.contains('dark');
    $('theme-toggle').setAttribute('aria-pressed', String(dark));
    $('theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    $('theme-toggle').title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    $('theme-toggle-label').textContent = dark ? 'Light mode' : 'Dark mode';
    $('theme-toggle-icon').textContent = dark ? '☀' : '☾';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#000000' : '#f3f6fb';
  }
})();
