import ExcelJS from 'exceljs';
import { toCsv } from './utils.mjs';

const EXPORT_PLATFORMS = ['Facebook', 'LinkedIn', 'X', 'Instagram', 'YouTube'];

export const CURRENT_RUN_COLUMNS = ['Name', 'Website', 'Time Collected (IST)', 'Facebook', 'LinkedIn', 'X', 'Instagram', 'Youtube', 'Sources'];

function istTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date);
}

function latestRun(rows) {
  return rows.reduce((latest, row) => String(row.run_id) > latest ? String(row.run_id) : latest, '');
}

function byLatest(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const current = map.get(key);
    if (!current || String(row.captured_at) > String(current.captured_at)) map.set(key, row);
  }
  return map;
}

function safeCsvText(value) {
  const text = String(value ?? '');
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function currentRunCsv(snapshots) {
  const runId = latestRun(snapshots);
  const rows = snapshots.filter(row => String(row.run_id) === runId);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.name}\u0000${row.website || ''}`;
    if (!groups.has(key)) groups.set(key, { Name: row.name, Website: row.website, captured: '', sources: [], ...Object.fromEntries(CURRENT_RUN_COLUMNS.slice(3, 8).map(platform => [platform, ''])) });
    const group = groups.get(key);
    if (String(row.captured_at) > String(group.captured)) group.captured = row.captured_at;
    const column = row.platform === 'YouTube' ? 'Youtube' : row.platform;
    if (CURRENT_RUN_COLUMNS.includes(column)) group[column] = row.status === 'collected' && row.count !== '' ? row.count : '';
    const source = row.source_url || row.profile_url;
    if (source) group.sources.push(source);
  }
  const output = [...groups.values()].map(group => {
    const source = group.sources[0] || '';
    return {
      Name: safeCsvText(group.Name),
      Website: safeCsvText(group.Website),
      'Time Collected (IST)': istTime(group.captured),
      Facebook: group.Facebook,
      LinkedIn: group.LinkedIn,
      X: group.X,
      Instagram: group.Instagram,
      Youtube: group.Youtube,
      Sources: source ? `=HYPERLINK("${source.replaceAll('"', '""')}","Source")` : '',
    };
  }).sort((a, b) => String(a.Name).localeCompare(String(b.Name)));
  return toCsv(output, CURRENT_RUN_COLUMNS);
}

function dateInIst(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export async function platformHistoryWorkbook(snapshots) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Social Follower Tracker';
  workbook.created = new Date();
  for (const platform of EXPORT_PLATFORMS) {
    const platformRows = snapshots.filter(row => row.platform === platform);
    const days = [...new Set(platformRows.map(row => dateInIst(row.captured_at)).filter(Boolean))].sort();
    const daily = byLatest(platformRows, row => `${row.name}\u0000${row.website || ''}\u0000${dateInIst(row.captured_at)}`);
    const entities = new Map();
    for (const row of platformRows) {
      const key = `${row.name}\u0000${row.website || ''}`;
      if (!entities.has(key)) entities.set(key, { name: row.name, website: row.website, latest: row, source: row.source_url || row.profile_url });
      const entity = entities.get(key);
      if (String(row.captured_at) > String(entity.latest.captured_at)) {
        entity.latest = row;
        entity.source = row.source_url || row.profile_url;
      }
    }
    const worksheet = workbook.addWorksheet(platform);
    const headers = ['Name', 'Website', 'Social Media Name', 'Time Collected (IST)', ...days.map((day, index) => `Follower Count - Date ${index + 1} (${day})`), 'Sources'];
    worksheet.addRow(headers);
    for (const entity of [...entities.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      const values = [entity.name, entity.website || '', entity.latest.handle || entity.latest.profile_url || '', istTime(entity.latest.captured_at)];
      for (const day of days) {
        const row = daily.get(`${entity.name}\u0000${entity.website || ''}\u0000${day}`);
        values.push(row?.status === 'collected' && row.count !== '' ? Number(row.count) : null);
      }
      values.push(entity.source ? { text: 'Source', hyperlink: entity.source } : '');
      worksheet.addRow(values);
    }
    worksheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 4 }];
    worksheet.autoFilter = { from: 'A1', to: `${worksheet.getColumn(worksheet.columnCount).letter}1` };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF245B55' } };
    worksheet.columns.forEach((column, index) => { column.width = index < 3 ? [32, 36, 20][index] : index === 3 ? 24 : index === worksheet.columnCount - 1 ? 14 : 26; });
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const source = row.getCell(worksheet.columnCount);
      if (source.value && typeof source.value === 'object') source.font = { color: { argb: 'FF0563C1' }, underline: true };
    });
  }
  return workbook.xlsx.writeBuffer();
}
