// Unit tests for supabase/functions/_shared/readAloudText.ts (the text the
// read-aloud function speaks). Run with Node 22+:
//
//   node --test supabase/tests/read_aloud_pure.test.ts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  FIRST_PART_CHARS,
  MAX_PART_CHARS,
  readAloudLang,
  readAloudParagraphs,
  readAloudParts,
  type ReadAloudSource,
} from '../functions/_shared/readAloudText.ts';

const base: ReadAloudSource = { title: null, mode: 'capture', summary: null, outline: null, tasks: [], ideas: [] };

describe('readAloudParagraphs', () => {
  test('reads title, summary, outline, tasks and ideas in screen order, without markup', () => {
    const paragraphs = readAloudParagraphs({
      ...base,
      title: '주간 회의',
      summary: '다음 주 **출시** 일정을 정했다',
      outline: [{ heading: '결정 사항', bullets: ['• 금요일 출시', '**QA**는 수요일까지!'] }],
      tasks: ['테스트 빌드 만들기'],
      ideas: ['베타 사용자 모집'],
    });
    assert.deepEqual(paragraphs, [
      '주간 회의.',
      '요약. 다음 주 출시 일정을 정했다.',
      '결정 사항. 금요일 출시. QA는 수요일까지!',
      '할 일 1개. 테스트 빌드 만들기.',
      '아이디어 1개. 베타 사용자 모집.',
    ]);
  });

  test('English labels when there is no Hangul; untitled note', () => {
    const src = { ...base, mode: 'note', summary: 'Plan the trip', tasks: ['Book hotel', 'Rent car'] };
    assert.equal(readAloudLang(src), 'en');
    assert.deepEqual(readAloudParagraphs(src), ['Untitled note.', 'Summary. Plan the trip.', 'Tasks 2. Book hotel. Rent car.']);
  });

  test('skips empty sections and tolerates malformed outline rows', () => {
    const src = {
      ...base,
      title: 'T',
      outline: [{ heading: '', bullets: [] }, { heading: 'H', bullets: 'nope' }, { bullets: [1, 'ok'] }],
    } as unknown as ReadAloudSource;
    assert.deepEqual(readAloudParagraphs(src), ['T.', 'H.', 'ok.']);
  });
});

describe('readAloudParts', () => {
  test('a short record is one part', () => {
    const parts = readAloudParts({ ...base, title: 'Hi', summary: 'Short.' });
    assert.deepEqual(parts, ['Hi.\nSummary. Short.']);
  });

  test('a long record splits on sentences within the limits and loses nothing', () => {
    const sentenceText = (i: number) => `이것은 ${i}번째 문장으로 꽤 길게 작성된 내용입니다.`;
    const bullets = Array.from({ length: 120 }, (_, i) => sentenceText(i));
    const src = { ...base, title: '긴 기록', summary: '요약 문장.', outline: [{ heading: '섹션', bullets }] };
    const parts = readAloudParts(src);
    assert.ok(parts.length > 2);
    assert.ok(parts[0].length <= FIRST_PART_CHARS);
    for (const p of parts) assert.ok(p.length <= MAX_PART_CHARS, `part too long: ${p.length}`);
    const joined = parts.join(' ');
    for (let i = 0; i < 120; i++) assert.ok(joined.includes(sentenceText(i)));
    // No sentence is cut in half.
    for (const p of parts) assert.match(p, /[.!?]$/);
  });

  test('a single sentence longer than a part is cut at a space', () => {
    const long = Array.from({ length: 600 }, () => 'word').join(' ');
    const parts = readAloudParts({ ...base, title: 'X', summary: long });
    for (const p of parts) assert.ok(p.length <= MAX_PART_CHARS);
    assert.equal(parts.join(' ').split('word').length - 1, 600);
  });

  test('empty record still says its title', () => {
    assert.deepEqual(readAloudParts(base), ['Untitled recording.']);
  });
});
