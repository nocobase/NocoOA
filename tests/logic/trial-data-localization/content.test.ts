// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { trialTranslationEntries } from '../../../server/locales/trial-data/catalog.ts';
import {
  translateTrialPayload,
  translateTrialMetadata,
} from '../../../server/providers/trial-data-localization/transform.ts';

const pairs = trialTranslationEntries();
const english = new Map(pairs);
const chinese = new Map(pairs.map(([zh, en]) => [en, zh]));

describe('fictional business content translations', () => {
  it('has unambiguous, complete English translations', () => {
    expect(english.size).toBe(pairs.length);
    expect(chinese.size).toBe(pairs.length);
    for (const [zh, en] of pairs) {
      expect(zh.trim()).not.toBe('');
      expect(en.trim()).not.toBe('');
      expect(en).not.toMatch(/\p{Script=Han}/u);
    }
  });

  it('covers every Chinese source literal in the trial generator', async () => {
    const directory = new URL(
      '../../../cli/commands/lib/trial-data/',
      import.meta.url,
    );
    const missing = new Set<string>();
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.ts')) continue;
      const source = ts.createSourceFile(
        file,
        await readFile(new URL(file, directory), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (
          (ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node)) &&
          /\p{Script=Han}/u.test(node.text) &&
          !node.text.startsWith('<w:document') &&
          !english.has(node.text)
        )
          missing.add(`${file}: ${node.text}`);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect([...missing]).toEqual([]);
  });

  it('localizes nested business fields and preserves record identities and frozen evidence', () => {
    const source = {
      data: [
        {
          id: 'same-id',
          code: 'oa-trial-v1-room',
          name: '示例·董事会议室',
          facilities: '投影、白板',
          status: 'active',
          contentHash: '示例·董事会议室',
          snapshot: { name: '示例·董事会议室' },
        },
        { id: 'real-id', name: '真实会议室', facilities: '投影、白板' },
      ],
    };
    const view = translateTrialPayload(source, english);
    expect(view.data[0]).toMatchObject({
      id: 'same-id',
      name: 'Demo · Boardroom',
      facilities: 'Projector, whiteboard',
      code: 'oa-trial-v1-room',
      status: 'active',
      contentHash: '示例·董事会议室',
      snapshot: { name: '示例·董事会议室' },
    });
    expect(view.data[1]).toEqual(source.data[1]);
    expect(source.data[0]!.name).toBe('示例·董事会议室');
    expect(translateTrialPayload(view, chinese)).toEqual(source);
  });

  it('preserves translated form values on a no-op save while retaining user edits', () => {
    const view = {
      name: 'Demo · Boardroom',
      facilities: 'Projector, whiteboard',
      reason: 'User edited explanation',
      requestId: 'Demo · Boardroom',
    };
    expect(translateTrialPayload(view, chinese)).toEqual({
      name: '示例·董事会议室',
      facilities: '投影、白板',
      reason: 'User edited explanation',
      requestId: 'Demo · Boardroom',
    });
  });

  it('round-trips standalone fictional explanations without an identity field', () => {
    const source = { reason: 'OA虚构试用数据初始化' };
    const view = translateTrialPayload(source, english);
    expect(view.reason).toBe('Initialize fictional OA trial data');
    expect(translateTrialPayload(view, chinese)).toEqual(source);
  });

  it('uses original content for unknown text and language metadata', () => {
    expect(translateTrialPayload({ name: '示例·新建会议室' }, english)).toEqual(
      { name: '示例·新建会议室' },
    );
    expect(
      translateTrialPayload(
        { label: { 'zh-CN': '示例·董事会议室', 'en-US': 'Custom English' } },
        english,
      ),
    ).toEqual({
      label: { 'zh-CN': '示例·董事会议室', 'en-US': 'Custom English' },
    });
    expect(translateTrialMetadata(['请假', '知识库'], english)).toEqual([
      'Leave',
      'Knowledge base',
    ]);
  });
});
