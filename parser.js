// Spreadsheet parsing and table detection. No DOM access: loaded as a plain
// script in the browser (window.AtlasParser) and required directly by the tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AtlasParser = api;
})(globalThis, () => {
  'use strict';

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
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]|$)/);
    if (iso) {
      // new Date('2025-01-01') is midnight UTC, which is the previous month west of Greenwich.
      const [year, month, day] = iso.slice(1).map(Number);
      const local = new Date(year, month - 1, day);
      const valid = local.getMonth() === month - 1 && local.getDate() === day && year >= 1900 && year <= 2200;
      return valid ? local : null;
    }
    const dotted = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dotted) {
      const [day, month, year] = dotted.slice(1).map(Number);
      const local = new Date(year, month - 1, day);
      const valid = local.getMonth() === month - 1 && local.getDate() === day && year >= 1900 && year <= 2200;
      return valid ? local : null;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getFullYear() < 1900 || date.getFullYear() > 2200) return null;
    return date;
  }

  function unique(values) { return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]; }

  function cleanCell(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
    return value;
  }
  function localDay(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function cellText(value) { return value instanceof Date ? localDay(value) : String(value ?? '').replace(/\s+/g, ' ').trim(); }
  // SheetJS 0.18 applies the zone's historical 1899 offset, so in Asia/Kolkata 1 Jan arrives
  // as 31 Dec 23:59:50. Rounding to the minute removes the drift and keeps real times.
  function normalizeSheetDates(matrix) {
    const minute = 60000;
    return matrix.map((row) => row.map((value) => (value instanceof Date ? new Date(Math.round(value.getTime() / minute) * minute) : value)));
  }
  // Files written with a decimal comma ("1.234,56") are detected once per sheet, because a single
  // value like "1,234" is ambiguous. Matching strings are rewritten to "1234.56" so toNumber reads them.
  function numberCore(text) { return text.trim().replace(/^\(|\)$/g, '').replace(/^[-+]/, '').replace(/[$£€¥₹%\s]/g, ''); }
  function usesDecimalComma(matrix) {
    let comma = 0, dot = 0;
    for (const row of matrix.slice(0, 2000)) {
      for (const value of row) {
        if (typeof value !== 'string') continue;
        const core = numberCore(value);
        if (!/^\d[\d.,]*$/.test(core)) continue;
        if (/^\d{1,3}(\.\d{3})+,\d+$|^\d+,(\d{1,2}|\d{4,})$|^\d{1,3}(\.\d{3}){2,}$/.test(core)) comma += 1;
        else if (/^\d{1,3}(,\d{3})+\.\d+$|^\d+\.(\d{1,2}|\d{4,})$|^\d{1,3}(,\d{3}){2,}$/.test(core)) dot += 1;
      }
    }
    return comma > dot;
  }
  function normalizeNumberFormats(matrix) {
    if (!usesDecimalComma(matrix)) return matrix;
    return matrix.map((row) => row.map((value) => {
      if (typeof value !== 'string' || !/^(\d{1,3}(\.\d{3})*|\d+)(,\d+)?$/.test(numberCore(value))) return value;
      return value.replace(/\./g, '').replace(',', '.');
    }));
  }
  function prepareMatrix(matrix) { return normalizeNumberFormats(normalizeSheetDates(matrix)); }
  // The delimiter is the character that splits most lines into the same number of fields.
  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 30).map((line) => line.replace(/"[^"]*"/g, ''));
    let best = ',', bestScore = 0;
    for (const delimiter of ['\t', ';', ',']) {
      const counts = lines.map((line) => line.split(delimiter).length - 1);
      const frequency = new Map();
      counts.forEach((count) => { if (count > 0) frequency.set(count, (frequency.get(count) || 0) + 1); });
      const score = Math.max(0, ...frequency.values());
      if (score > bestScore) { best = delimiter; bestScore = score; }
    }
    return best;
  }
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

  function columnValues(column, rows) { return rows.map((row) => row[column]).filter((value) => !isEmptyCell(value)); }
  function holdsYears(column, rows) {
    const values = columnValues(column, rows);
    return values.length > 0 && values.every((value) => {
      const number = toNumber(value);
      return Number.isInteger(number) && number >= 1900 && number <= 2200;
    });
  }
  // "Year" is never a measure, but "This Year" often holds amounts, so a suffix match needs year-like values.
  function isCalendarField(column, rows) {
    if (/^(?:(?:fiscal[\s_-]*)?(?:year|yr|quarter|qtr|month|week)|fy)$/i.test(column)) return true;
    return /(?:^|[\s_-])(?:year|yr|fy)$/i.test(column) && holdsYears(column, rows);
  }
  function isYearField(column, rows) {
    return /(?:^|[\s_-])(?:year|yr|fy)$/i.test(column) && holdsYears(column, rows) && unique(rows.map((row) => row[column])).length >= 2;
  }
  function isCodeField(column) { return /^(rank|category|type)$/i.test(column); }

  // Prices, rates and scores are averaged; adding them up across rows means nothing.
  function defaultAggregation(column, rows) {
    if (/^(total|sum)\b|\btotal$|amount|revenue|sales/i.test(column)) return 'sum';
    if (/price|rate\b|ratio|percent|pct|%|\bavg\b|average|mean|median|score|rating|\bage\b|\bper\s|growth|yield|utili[sz]ation/i.test(column)) return 'mean';
    const values = columnValues(column, rows);
    const percentText = values.filter((value) => typeof value === 'string' && /%\s*$/.test(value)).length;
    if (values.length && percentText / values.length >= 0.5) return 'mean';
    if (/margin|share|conversion/i.test(column) && values.length && values.every((value) => Math.abs(toNumber(value)) <= 1.5)) return 'mean';
    return 'sum';
  }

  function chooseMetric(columns, rows) {
    const numeric = columns.filter((column) => {
      const values = rows.map((row) => row[column]).filter((value) => !isEmptyCell(value));
      return values.length > 0 && values.filter((value) => Number.isFinite(toNumber(value))).length / values.length >= 0.62;
    });
    const usable = numeric.filter((column) => !isCalendarField(column, rows) && !isCodeField(column) && !/(^id$|_id$|\bid\b|zip|postal|phone|latitude|longitude|^sr\s*no|serial|invoice\s*(no|number)|voucher\s*(no|number)|payment\s*number)/i.test(column));
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
  function isTotalRow(value) { return /^(?:(?:.*\s)?(?:sub[\s-]?)?totals?|total\s+result):?$/i.test(cellText(value)); }
  function firstFilled(values) { return values.find((value) => !isEmptyCell(value)); }
  // A row is a summary if it is labelled Total (first filled cell), or if its label cells are blank
  // or say Total somewhere and every number equals the sum of the rows above it.
  function dropSummaryRows(entries, labelKeys, numericKeys) {
    const zero = () => Object.fromEntries(numericKeys.map((key) => [key, 0]));
    let block = zero(), blockCount = 0, running = zero(), runningCount = 0, excluded = 0;
    const kept = [];
    const close = (a, b) => Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 1e-6);
    for (const { cells, first } of entries) {
      if (isTotalRow(first)) { excluded += 1; block = zero(); blockCount = 0; continue; }
      const labels = labelKeys.map((key) => cells[key]);
      const blankLabels = labelKeys.length > 0 && labels.every(isEmptyCell);
      const totalLabel = labels.some((value) => isTotalRow(value));
      if (blankLabels || totalLabel) {
        const filled = numericKeys.filter((key) => Number.isFinite(toNumber(cells[key])));
        const minimum = totalLabel ? 1 : 2;
        const matches = (sums, count) => count >= minimum && filled.length > 0 && filled.some((key) => toNumber(cells[key]) !== 0)
          && filled.every((key) => close(toNumber(cells[key]), sums[key]));
        if (matches(block, blockCount) || matches(running, runningCount)) { excluded += 1; block = zero(); blockCount = 0; continue; }
      }
      kept.push(cells);
      numericKeys.forEach((key) => {
        const value = toNumber(cells[key]);
        if (Number.isFinite(value)) { block[key] += value; running[key] += value; }
      });
      blockCount += 1; runningCount += 1;
    }
    return { kept, excluded };
  }
  function splitKeys(entries, keys) {
    const numericKeys = [], labelKeys = [];
    keys.forEach((key) => {
      const values = entries.map(({ cells }) => cells[key]).filter((value) => !isEmptyCell(value));
      if (!values.length) return;
      const numeric = values.filter((value) => Number.isFinite(toNumber(value)) && !(value instanceof Date)).length / values.length;
      (numeric >= 0.62 ? numericKeys : labelKeys).push(key);
    });
    return { numericKeys, labelKeys };
  }
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
    const entries = [];
    for (let r = candidate.startRow; r <= candidate.dataEnd; r += 1) {
      const source = matrix[r] || [];
      entries.push({ cells: source, first: firstFilled(otherColumns.map(({ column }) => source[column])) });
    }
    const { kept, excluded: excludedTotalRows } = dropSummaryRows(entries, otherColumns.map(({ column }) => column), periods.map(({ column }) => column));
    for (const source of kept) {
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
    return { rows: output, headers: [...otherColumns.map((item) => item.name), 'Period', ...groups], startRow: candidate.startRow, dataEnd: candidate.dataEnd, score: candidate.score + output.length / 100, support: candidate.support, periodColumn: 'Period', measureGroups: groups, excludedTotalRows };
  }
  function regularCandidateRows(matrix, candidate) {
    const entries = [];
    for (let r = candidate.startRow; r <= candidate.dataEnd; r += 1) {
      const source = matrix[r] || [];
      if (!candidate.columns.some((column) => !isEmptyCell(source[column]))) continue;
      const row = Object.fromEntries(candidate.columns.map((column, index) => [candidate.headers[index], cleanCell(source[column])]));
      const notEmpty = Object.values(row).filter((value) => !isEmptyCell(value)).length;
      if (notEmpty >= Math.min(2, candidate.columns.length)) entries.push({ cells: row, first: firstFilled(candidate.columns.map((column) => source[column])) });
    }
    const { numericKeys, labelKeys } = splitKeys(entries, candidate.headers);
    const { kept, excluded } = dropSummaryRows(entries, labelKeys, numericKeys);
    return { rows: kept, excludedTotalRows: excluded };
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
      const { rows, excludedTotalRows } = reshaped || regularCandidateRows(matrix, candidate);
      if (!rows.length) return null;
      return { ...candidate, ...reshaped, rows, excludedTotalRows, headers: reshaped?.headers || candidate.headers, periodColumn: reshaped?.periodColumn || '' };
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
    const metrics = chooseMetric(columns.filter((column) => column !== table.periodColumn), rows);
    const yearColumn = columns.find((column) => isYearField(column, rows));
    const dateCandidate = table.periodColumn || columns.find((column) => /date|time|month|period|day/i.test(column) && rows.filter((row) => parseDate(row[column])).length / Math.max(rows.length, 1) >= 0.48)
      || columns.find((column) => rows.filter((row) => parseDate(row[column])).length / Math.max(rows.length, 1) >= 0.78)
      || yearColumn || '';
    const periodColumn = table.periodColumn || (dateCandidate === yearColumn ? yearColumn : '');
    const dimensions = columns.filter((column) => {
      if (column === dateCandidate || metrics.includes(column) || /comments?|description|notes?|address|postal|phone|tariff|alias/i.test(column)) return false;
      const values = rows.map((row) => row[column]).filter((value) => !isEmptyCell(value));
      const cardinality = unique(values).length;
      if (cardinality < 2 || !values.length) return false;
      const numericRatio = values.filter((value) => Number.isFinite(toNumber(value))).length / values.length;
      if (numericRatio > 0.8) return (isCalendarField(column, rows) || isCodeField(column)) && cardinality <= 60;
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
    return { rows, columns, metrics, dimensions, dateColumn: dateCandidate, periodColumn, reshapedPeriods: Boolean(table.periodColumn), excludedTotalRows: table.excludedTotalRows || 0, aggregations: Object.fromEntries(metrics.map((metric) => [metric, defaultAggregation(metric, rows)])), categoryDimension, regionDimension, sheetName, tableIndex, title, fileName, currencySymbol, tableScore: table.score || 0, rankScore: rowScore };
  }

  function stripExtension(filename) { return String(filename || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(); }

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

  function detectCurrency(workbook, matrices = [], sheetUtils = null) {
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
      const range = sheet?.['!ref'] ? sheetUtils.decode_range(sheet['!ref']) : null;
      if (!range) continue;
      for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 80); row += 1) {
        for (let column = range.s.c; column <= Math.min(range.e.c, range.s.c + 40); column += 1) {
          const cell = sheet[sheetUtils.encode_cell({ r: row, c: column })];
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

  // method is 'sum' or 'mean'; mean ignores blank and non-numeric cells.
  function metricTotal(rows, metric, columns, method = 'sum') {
    if (!metric || metric === 'Records' || !columns.includes(metric)) return rows.length;
    let sum = 0, count = 0;
    rows.forEach((row) => {
      const value = toNumber(row[metric]);
      if (Number.isFinite(value)) { sum += value; count += 1; }
    });
    return method === 'mean' ? (count ? sum / count : 0) : sum;
  }
  function aggregate(rows, dimension, metric, { columns, dateColumn, periodColumn, sort = false, method = 'sum' }) {
    if (!dimension) return [{ key: 'All records', label: 'All records', value: metricTotal(rows, metric, columns, method) }];
    const groups = new Map();
    rows.forEach((row) => {
      const raw = row[dimension];
      const date = dimension === dateColumn ? parseDate(raw) : null;
      const periodLabel = dimension === periodColumn;
      const key = date ? (periodLabel ? String(raw).trim() : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`) : String(raw ?? 'Unknown').trim() || 'Unknown';
      const label = date ? (periodLabel ? String(raw).trim() : date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })) : key;
      const value = metric && columns.includes(metric) ? toNumber(row[metric]) : 1;
      const current = groups.get(key) || { key, label, value: 0, sum: 0, count: 0, sortValue: date?.getTime() ?? null };
      if (Number.isFinite(value)) { current.sum += value; current.count += 1; }
      groups.set(key, current);
    });
    const result = [...groups.values()];
    result.forEach((group) => { group.value = method === 'mean' ? (group.count ? group.sum / group.count : 0) : group.sum; });
    if (dimension === dateColumn) result.sort((a, b) => (a.sortValue ?? Number.MAX_SAFE_INTEGER) - (b.sortValue ?? Number.MAX_SAFE_INTEGER) || a.key.localeCompare(b.key, undefined, { numeric: true }));
    else if (sort) result.sort((a, b) => b.value - a.value);
    return result;
  }

  // Dates export as calendar text, and text that Excel would run as a formula gets a leading quote.
  function csvCell(value) {
    let text;
    if (value instanceof Date) {
      const time = value.getHours() || value.getMinutes() ? ` ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}` : '';
      text = `${localDay(value)}${time}`;
    } else text = String(value ?? '');
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^[+-]?[\d.,\s]+%?$/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  return {
    metricTotal, aggregate, csvCell, prepareMatrix, detectDelimiter, normalizeNumberFormats, defaultAggregation,
    toNumber, parseDate, unique, cleanCell, cellText, isEmptyCell, parsePeriodHeader, isTotalRow,
    chooseMetric, extractTables, datasetProfile, stripExtension, parseDelimited, detectCurrency, normalizeSheetDates,
  };
});
