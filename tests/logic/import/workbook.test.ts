// @vitest-environment node
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  closesLoop,
  orderMoves,
} from '../../../server/providers/import/cells.ts';
import { KIND_SPECS } from '../../../server/providers/import/index.ts';
import {
  buildTemplate,
  readSheet,
} from '../../../server/providers/import/workbook.ts';
import { workbookBytes } from './helpers.ts';

describe('reading a workbook', () => {
  it('maps Chinese or key headers to columns, skips blank rows and ignores unknown columns', async () => {
    const bytes = await workbookBytes(
      ['备注', '部门编码', 'title', '上级部门编码'],
      [
        ['note', 'HQ', '总公司', null],
        [null, null, null, null],
        [null, ' RD ', '研发', 'HQ'],
      ],
    );
    const sheet = await readSheet('departments', bytes);
    expect(sheet.errors).toEqual([]);
    expect(sheet.columns.map((column) => column.key)).toEqual([
      'code',
      'title',
      'parentCode',
    ]);
    expect(sheet.rows.map((row) => row.row)).toEqual([2, 4]);
    expect(Object.fromEntries(sheet.rows[1]!.cells)).toEqual({
      code: 'RD',
      title: '研发',
      parentCode: 'HQ',
    });
  });

  it('reports a missing required header, a repeated header and an unreadable file', async () => {
    const missing = await readSheet(
      'grades',
      await workbookBytes(['职级编码', '职级名称'], [['P5', 'P5']]),
    );
    expect(missing.errors).toEqual([
      { row: 1, column: 'rank', header: '级别', code: 'HEADER_MISSING' },
    ]);
    const repeated = await readSheet(
      'positions',
      await workbookBytes(['岗位编码', '岗位名称', 'code'], [['A', 'B', 'C']]),
    );
    expect(repeated.errors.map((error) => error.code)).toEqual([
      'HEADER_DUPLICATE',
    ]);
    const garbage = await readSheet(
      'positions',
      new TextEncoder().encode('not a workbook'),
    );
    expect(garbage.errors.map((error) => error.code)).toEqual([
      'FILE_UNREADABLE',
    ]);
    const empty = await readSheet(
      'positions',
      await workbookBytes(['岗位编码', '岗位名称'], []),
    );
    expect(empty.errors.map((error) => error.code)).toEqual(['SHEET_EMPTY']);
  });

  it('reads rich text, formulas and dates', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('员工档案');
    sheet.addRow(['工号', '姓名', '入职日期']);
    sheet.addRow([
      { formula: '"E"&"01"', result: 'E01' },
      { richText: [{ text: '张' }, { text: '三' }] },
      new Date(Date.UTC(2026, 9, 1)),
    ]);
    const bytes = new Uint8Array(
      (await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );
    const parsed = await readSheet('employees', bytes);
    const cells = parsed.rows[0]!.cells;
    expect(cells.get('code')).toBe('E01');
    expect(cells.get('name')).toBe('张三');
    expect(cells.get('hireDate')).toBeInstanceOf(Date);
  });

  it('builds a template whose data sheet reads back with every column and an instructions sheet', async () => {
    for (const spec of Object.values(KIND_SPECS)) {
      const bytes = await buildTemplate(spec.kind);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
        spec.sheet,
        '说明',
      ]);
      const parsed = await readSheet(spec.kind, bytes);
      // A template without data has its headers right and no rows.
      expect(parsed.errors.map((error) => error.code)).toEqual(['SHEET_EMPTY']);
      expect(parsed.columns.map((column) => column.key)).toEqual(
        spec.columns.map((column) => column.key),
      );
    }
  });
});

describe('reparenting order', () => {
  it('detects loops in a parent map', () => {
    const parents = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
      ['d', null],
    ]);
    expect(closesLoop(parents, 'a')).toBe(true);
    expect(closesLoop(parents, 'd')).toBe(false);
  });

  it('swaps two nodes without ever passing through a loop', () => {
    // Now: root > a > b. Target: root > b > a.
    const current = new Map<string, string | null>([
      ['root', null],
      ['a', 'root'],
      ['b', 'a'],
    ]);
    const moves = new Map<string, string | null>([
      ['b', 'root'],
      ['a', 'b'],
    ]);
    const steps = orderMoves(current, moves);
    const state = new Map(current);
    for (const step of steps) {
      state.set(step.id, step.parent);
      for (const id of state.keys()) expect(closesLoop(state, id)).toBe(false);
    }
    expect(state.get('a')).toBe('b');
    expect(state.get('b')).toBe('root');
  });

  it('detaches a node still hanging from its old parent when needed', () => {
    // Now: x > y > z. Target: z > x, y at the top.
    const current = new Map<string, string | null>([
      ['x', null],
      ['y', 'x'],
      ['z', 'y'],
    ]);
    const moves = new Map<string, string | null>([
      ['x', 'z'],
      ['z', null],
    ]);
    const state = new Map(current);
    for (const step of orderMoves(current, moves)) {
      state.set(step.id, step.parent);
      for (const id of state.keys()) expect(closesLoop(state, id)).toBe(false);
    }
    expect(state.get('x')).toBe('z');
    expect(state.get('z')).toBe(null);
  });
});

it('builds every English template with translated examples and accepts English headers', async () => {
  for (const spec of Object.values(KIND_SPECS)) {
    const bytes = await buildTemplate(spec.kind, 'en-US');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(book.getWorksheet('Instructions')).toBeDefined();
    for (const sheet of book.worksheets)
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          expect(String(cell.value ?? '')).not.toMatch(/\p{Script=Han}/u);
          if (typeof cell.note === 'string')
            expect(cell.note).not.toMatch(/\p{Script=Han}/u);
        }),
      );
    const parsed = await readSheet(spec.kind, bytes);
    expect(parsed.columns.map((column) => column.key)).toEqual(
      spec.columns.map((column) => column.key),
    );
    expect(parsed.errors.map((error) => error.code)).toEqual(['SHEET_EMPTY']);
    book.worksheets[0]!.addRow(
      spec.example[0]!.map((value) => (value === '是' ? 'Yes' : value)),
    );
    const populated = await readSheet(
      spec.kind,
      new Uint8Array(await book.xlsx.writeBuffer()),
    );
    expect(populated.errors).toEqual([]);
  }
});
