import { workbookEnUS } from '../../locales/import-workbook/en-US.js';
import {
  GENERAL_RULES,
  guideZhCN,
} from '../../locales/import-workbook/zh-CN.js';
import ExcelJS from 'exceljs';

import { KIND_SPECS, type ColumnSpec, type KindSpec } from './columns.js';
import { MAX_ROWS, type ImportKind } from './constants.js';
import type { ImportRowError } from './types.js';

/** A cell as the validators read it: text (trimmed), a number, a boolean, a date, or nothing. */
export type RawCell = string | number | boolean | Date | null;

export interface SheetRow {
  /** The Excel row number, as the user sees it. */
  readonly row: number;
  /** Values of the columns present in the header, by column key. */
  readonly cells: ReadonlyMap<string, RawCell>;
}

export interface ParsedSheet {
  /** The columns the header names; a column the header leaves out is left unchanged on existing records. */
  readonly columns: readonly ColumnSpec[];
  readonly rows: readonly SheetRow[];
  /** File-level problems: unreadable workbook, missing or repeated headers, too many rows. */
  readonly errors: readonly ImportRowError[];
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/gu, '').replace(/[*＊]/gu, '').toLowerCase();
}

/** The plain value of an ExcelJS cell: rich text joined, formulas by their cached result, hyperlinks by their text. */
function plain(value: ExcelJS.CellValue): RawCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('richText' in value)
      return plain(value.richText.map((part) => part.text).join(''));
    if ('formula' in value || 'sharedFormula' in value)
      return plain((value as ExcelJS.CellFormulaValue).result ?? null);
    if ('hyperlink' in value && 'text' in value) return plain(value.text);
    if ('error' in value) return null;
  }
  return null;
}

/** Reads the first worksheet of an `.xlsx` workbook against a kind's columns. */
export async function readSheet(
  kind: ImportKind,
  bytes: Uint8Array,
): Promise<ParsedSheet> {
  const spec = KIND_SPECS[kind];
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    return fileError('FILE_UNREADABLE');
  }
  // The template's data sheet when it is there, otherwise the first sheet that is not the instructions.
  const sheet =
    workbook.getWorksheet(spec.sheet) ??
    workbook.getWorksheet(workbookEnUS.kinds[kind].sheet) ??
    workbook.worksheets.find(
      (candidate) => !['说明', 'Instructions'].includes(candidate.name),
    );
  if (!sheet || sheet.actualRowCount === 0) return fileError('SHEET_EMPTY');

  const byHeader = new Map<string, ColumnSpec>();
  for (const column of spec.columns) {
    byHeader.set(normalizeHeader(column.header), column);
    byHeader.set(normalizeHeader(column.key), column);
    const translated = workbookEnUS.kinds[kind].columns as Readonly<
      Record<string, readonly [string, string]>
    >;
    byHeader.set(normalizeHeader(translated[column.key][0]), column);
  }
  const headerRow = sheet.getRow(1);
  const positions = new Map<number, ColumnSpec>();
  const seen = new Set<string>();
  const errors: ImportRowError[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, index) => {
    const text = plain(cell.value);
    if (typeof text !== 'string') return;
    const column = byHeader.get(normalizeHeader(text));
    // Columns the kind does not know (a note column, a helper formula) are ignored.
    if (!column) return;
    if (seen.has(column.key)) {
      errors.push({
        row: 1,
        column: column.key,
        header: column.header,
        code: 'HEADER_DUPLICATE',
      });
      return;
    }
    seen.add(column.key);
    positions.set(index, column);
  });
  for (const column of spec.columns)
    if (column.required && !seen.has(column.key))
      errors.push({
        row: 1,
        column: column.key,
        header: column.header,
        code: 'HEADER_MISSING',
      });

  const rows: SheetRow[] = [];
  const last = sheet.actualRowCount === 0 ? 1 : sheet.rowCount;
  for (let number = 2; number <= last; number += 1) {
    const row = sheet.getRow(number);
    const cells = new Map<string, RawCell>();
    let filled = false;
    for (const [index, column] of positions) {
      const value = plain(row.getCell(index).value);
      if (value !== null) filled = true;
      cells.set(column.key, value);
    }
    if (!filled) continue;
    rows.push({ row: number, cells });
    if (rows.length > MAX_ROWS) {
      errors.push({
        row: null,
        column: null,
        header: null,
        code: 'TOO_MANY_ROWS',
        params: { max: MAX_ROWS },
      });
      break;
    }
  }
  if (!errors.length && !rows.length)
    errors.push({ row: null, column: null, header: null, code: 'SHEET_EMPTY' });
  return {
    columns: spec.columns.filter((column) => seen.has(column.key)),
    rows,
    errors,
  };
}

function fileError(code: 'FILE_UNREADABLE' | 'SHEET_EMPTY'): ParsedSheet {
  return {
    columns: [],
    rows: [],
    errors: [{ row: null, column: null, header: null, code }],
  };
}

/** Localized headers, instructions and examples. Both languages remain valid when reading a workbook. */
export async function buildTemplate(
  kind: ImportKind,
  locale: string = 'zh-CN',
): Promise<Uint8Array<ArrayBuffer>> {
  const source = KIND_SPECS[kind];
  const translated = workbookEnUS.kinds[kind];
  const english = locale === 'en-US';
  const columns = translated.columns as Readonly<
    Record<string, readonly [string, string]>
  >;
  const spec: KindSpec = english
    ? {
        ...source,
        sheet: translated.sheet,
        title: translated.title,
        matchedBy: translated.matchedBy,
        columns: source.columns.map((column) => ({
          ...column,
          header: columns[column.key][0],
          note: columns[column.key][1],
        })),
        example: source.example.map((row) =>
          row.map(
            (value) =>
              workbookEnUS.examples[
                value as keyof typeof workbookEnUS.examples
              ] ?? value,
          ),
        ),
      }
    : source;
  const guideText = english ? workbookEnUS.guide : guideZhCN;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OA';

  const data = workbook.addWorksheet(spec.sheet, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  data.columns = spec.columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: Math.max(12, column.header.length * 2 + 6),
    // Text format keeps leading zeros of codes and stops Excel from turning them into numbers.
    style:
      column.type === 'integer' || column.type === 'date'
        ? {}
        : { numFmt: '@' },
  }));
  const header = data.getRow(1);
  header.font = { bold: true };
  spec.columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.header;
    cell.numFmt = 'General';
    if (column.required)
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFF2CC' },
      };
    if (column.note) cell.note = column.note;
  });

  const guide = workbook.addWorksheet(guideText.sheet);
  guide.columns = [{ width: 20 }, { width: 10 }, { width: 90 }];
  guide.addRow([guideText.title.replace('{{title}}', spec.title)]).font = {
    bold: true,
    size: 14,
  };
  guide.addRow([]);
  guide.addRow([guideText.rules]).font = { bold: true };
  (english ? workbookEnUS.rules : GENERAL_RULES).forEach((rule, index) =>
    guide.addRow([`${index + 1}.`, '', rule]),
  );
  guide.addRow([guideText.matchedBy, '', spec.matchedBy]);
  guide.addRow([]);
  guide.addRow([
    guideText.column,
    guideText.required,
    guideText.explanation,
  ]).font = { bold: true };
  for (const column of spec.columns)
    guide.addRow([
      column.header,
      column.required ? guideText.yes : '',
      column.note,
    ]);
  guide.addRow([]);
  guide.addRow([guideText.example]).font = {
    bold: true,
  };
  guide.addRow(spec.columns.map((column) => column.header)).font = {
    bold: true,
  };
  for (const example of spec.example) guide.addRow([...example]);
  guide.getColumn(3).alignment = { wrapText: true, vertical: 'top' };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
