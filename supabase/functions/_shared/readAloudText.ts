// Builds the text that "Read aloud" speaks for one record (the Summary tab of
// app/summary.tsx): the title, the summary, each outline section, then the
// tasks and ideas -- exactly what the screen shows, read out as is (no AI
// rewriting), so nothing is spoken that isn't written there.
//
// Pure (no Deno, no network) so supabase/tests/read_aloud_pure.test.ts can
// run it under Node.

export type ReadAloudSource = {
  title: string | null;
  mode: string | null;
  summary: string | null;
  outline: { heading?: unknown; bullets?: unknown }[] | null;
  tasks: string[];
  ideas: string[];
};

/** OpenAI TTS accepts up to 4096 characters; parts stay well below that. */
export const MAX_PART_CHARS = 1400;
/** The first part is short so the voice starts quickly. */
export const FIRST_PART_CHARS = 450;

const LABELS = {
  ko: { untitled: '제목 없는 기록', untitledNote: '제목 없는 메모', summary: '요약', tasks: '할 일', ideas: '아이디어', count: (n: number) => `${n}개` },
  en: { untitled: 'Untitled recording', untitledNote: 'Untitled note', summary: 'Summary', tasks: 'Tasks', ideas: 'Ideas', count: (n: number) => `${n}` },
};

export function readAloudLang(src: ReadAloudSource): 'ko' | 'en' {
  const all = [
    src.title ?? '',
    src.summary ?? '',
    ...(src.outline ?? []).flatMap((s) => [String(s.heading ?? ''), ...asStrings(s.bullets)]),
    ...src.tasks,
    ...src.ideas,
  ].join(' ');
  return /[가-힣]/.test(all) ? 'ko' : 'en';
}

/** Spoken paragraphs, in reading order. */
export function readAloudParagraphs(src: ReadAloudSource): string[] {
  const L = LABELS[readAloudLang(src)];
  const out: string[] = [];
  out.push(sentence(clean(src.title ?? '') || (src.mode === 'note' ? L.untitledNote : L.untitled)));
  const summary = clean(src.summary ?? '');
  if (summary) out.push(`${L.summary}. ${sentence(summary)}`);
  for (const section of src.outline ?? []) {
    const heading = clean(String(section.heading ?? ''));
    const bullets = asStrings(section.bullets).map(clean).filter(Boolean).map(sentence);
    if (!heading && bullets.length === 0) continue;
    out.push([heading ? sentence(heading) : '', ...bullets].filter(Boolean).join(' '));
  }
  const tasks = src.tasks.map(clean).filter(Boolean);
  if (tasks.length) out.push(`${L.tasks} ${L.count(tasks.length)}. ${tasks.map(sentence).join(' ')}`);
  const ideas = src.ideas.map(clean).filter(Boolean);
  if (ideas.length) out.push(`${L.ideas} ${L.count(ideas.length)}. ${ideas.map(sentence).join(' ')}`);
  return out;
}

/**
 * Splits the text into parts small enough for one TTS call each, packing
 * whole sentences (a sentence longer than a part is cut at a space).
 */
export function readAloudParts(src: ReadAloudSource): string[] {
  const parts: string[] = [];
  let current = '';
  for (const paragraph of readAloudParagraphs(src)) {
    splitSentences(paragraph)
      .flatMap((s) => hardSplit(s, MAX_PART_CHARS))
      .forEach((piece, i) => {
        const sep = current ? (i === 0 ? '\n' : ' ') : '';
        const limit = parts.length === 0 ? FIRST_PART_CHARS : MAX_PART_CHARS;
        if (current && current.length + sep.length + piece.length > limit) {
          parts.push(current);
          current = piece;
        } else {
          current += sep + piece;
        }
      });
  }
  if (current) parts.push(current);
  return parts;
}

function splitSentences(text: string): string[] {
  return (text.match(/[^.!?。？！]*(?:[.!?。？！]+|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

function hardSplit(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Display-only markup (**bold**, bullets, stray markdown) is not spoken. */
function clean(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/^[\s•\-*#>]+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/** Ends with punctuation so the voice pauses between items. */
function sentence(text: string): string {
  return /[.!?。？！:;…]$/.test(text) ? text : `${text}.`;
}
