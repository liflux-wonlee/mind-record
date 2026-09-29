// Pure text helpers for the spoken "today's reminders" briefing
// (supabase/functions/reminder-briefing): the per-item line shown with it,
// the fallback script used when the AI can't write one, and what goes into
// the cache key. No Deno/npm imports -- unit tested with Node.
import { localDateOf, localTimeOf, spokenDate, spokenWhen } from './reminderRules.ts';

export type BriefingItem = {
  index: number;
  targetType: 'task' | 'session' | 'memory';
  targetId: string;
  title: string;
  /** overdue | due_today | daily | scheduled_today | pending */
  reason: string;
  dueDate: string | null;
  note: string | null;
  purpose: string;
  nextFireAt: string | null;
};

/** Only Korean and English have hand-written phrases; other languages get English ones (the AI writes the real script). */
export type TemplateLang = 'ko' | 'en';

export function templateLang(lang: string): TemplateLang {
  return lang === 'ko' ? 'ko' : 'en';
}

/** "ko-KR" -> "ko"; junk -> null. */
export function primaryLang(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^([a-zA-Z]{2,3})(?:[-_].*)?$/.exec(v.trim());
  return m ? m[1].toLowerCase() : null;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Why it's on today's list, in a few words. */
export function reasonLabel(item: BriefingItem, lang: TemplateLang, today: string, tz: string): string {
  if (item.purpose === 'waiting' && item.reason !== 'overdue') return lang === 'ko' ? '답변 왔는지 확인' : 'check for a reply';
  switch (item.reason) {
    case 'overdue': {
      if (!item.dueDate) return lang === 'ko' ? '기한 지남' : 'overdue';
      const d = spokenDate(item.dueDate, today);
      return lang === 'ko' ? `기한 지남(${d.ko})` : `overdue (was due ${d.en})`;
    }
    case 'due_today':
      return lang === 'ko' ? '오늘까지' : 'due today';
    case 'daily':
      return lang === 'ko' ? '완료할 때까지 매일' : 'daily until done';
    case 'scheduled_today': {
      if (item.nextFireAt && localDateOf(new Date(item.nextFireAt), tz) === today) {
        const w = spokenWhen(new Date(item.nextFireAt), tz, today);
        return lang === 'ko' ? w.ko : w.en;
      }
      return lang === 'ko' ? '오늘' : 'today';
    }
    case 'pending':
      return lang === 'ko' ? '아직 완료 표시 없음' : 'not marked done yet';
    default:
      return '';
  }
}

export function itemLine(item: BriefingItem, lang: TemplateLang, today: string, tz: string): string {
  const label = reasonLabel(item, lang, today, tz);
  return label ? `${clip(item.title, 80)} · ${label}` : clip(item.title, 80);
}

const ORDINALS_KO = ['첫째', '둘째', '셋째'];
const ORDINALS_EN = ['First', 'Second', 'Third'];

/** The script when there is nothing for today (no AI needed). */
export function emptyScript(lang: TemplateLang, honorific: string | null, laterCount: number): string {
  const h = honorific ? `${honorific}, ` : '';
  if (lang === 'ko') {
    return `${h}오늘 챙길 건 없어요.${laterCount > 0 ? ` 나중에 알려드릴 게 ${laterCount}개 있어요.` : ''} 편안한 하루 보내세요.`;
  }
  return `${h}nothing to keep in mind today.${laterCount > 0 ? ` ${laterCount} more ${laterCount === 1 ? 'is' : 'are'} set for later.` : ''} Have a good day!`;
}

/**
 * The deterministic script used when the AI fails: the count, up to three
 * items with their reason and stored note, "not marked done yet" (never
 * claiming more), and an offer to go on when there are more.
 */
export function templateScript(items: BriefingItem[], lang: TemplateLang, honorific: string | null, today: string, tz: string): string {
  if (items.length === 0) return emptyScript(lang, honorific, 0);
  const h = honorific ? `${honorific}, ` : '';
  const top = items.slice(0, 3);
  const parts: string[] = [];
  if (lang === 'ko') {
    parts.push(`${h}오늘 챙길 것이 ${items.length}개 있어요.`);
    top.forEach((it, i) => {
      const label = reasonLabel(it, 'ko', today, tz);
      const note = it.note ? ` ${clip(it.note, 80)}.` : '';
      parts.push(`${items.length > 1 ? `${ORDINALS_KO[i]}, ` : ''}${clip(it.title, 60)}${label ? `, ${label}` : ''}.${note}`);
    });
    parts.push('아직 완료 표시는 없어요.');
    if (items.length > 3) parts.push('나머지도 들으시겠어요?');
  } else {
    parts.push(`${h}you have ${items.length} ${items.length === 1 ? 'thing' : 'things'} to keep in mind today.`);
    top.forEach((it, i) => {
      const label = reasonLabel(it, 'en', today, tz);
      const note = it.note ? ` ${clip(it.note, 80)}.` : '';
      parts.push(`${items.length > 1 ? `${ORDINALS_EN[i]}, ` : ''}${clip(it.title, 60)}${label ? `, ${label}` : ''}.${note}`);
    });
    parts.push(items.length === 1 ? "It isn't marked done yet." : "None of these is marked done yet.");
    if (items.length > 3) parts.push('Want to hear the rest?');
  }
  // Capitalize the first letter of an English script that starts without an honorific.
  const text = parts.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * What the cached script depends on: every item's identity, state and
 * wording, the day, and how it is spoken. Any change -> a new script (so a
 * task completed since is never read out again from an old one).
 */
export function briefingHashInput(p: {
  today: string;
  tz: string;
  lang: string;
  voice: string;
  aiName: string | null;
  honorific: string | null;
  laterCount: number;
  items: BriefingItem[];
}): string {
  return JSON.stringify({
    v: 1,
    today: p.today,
    lang: p.lang,
    voice: p.voice,
    aiName: p.aiName,
    honorific: p.honorific,
    later: p.laterCount,
    items: p.items.map((i) => [
      i.targetType,
      i.targetId,
      i.reason,
      i.title,
      i.note,
      i.dueDate,
      i.purpose,
      // Only the local time matters for what is said.
      i.nextFireAt ? `${localDateOf(new Date(i.nextFireAt), p.tz)} ${localTimeOf(new Date(i.nextFireAt), p.tz)}` : null,
    ]),
  });
}
