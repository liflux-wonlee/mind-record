// Pure text helpers for the spoken reminder briefing
// (supabase/functions/reminder-briefing), which reads out EVERY active
// reminder -- today's first, then the ones set for later, then the
// situation ones -- and opens a voice conversation about them: the per-item
// line shown with it, the fallback script used when the AI can't write one,
// and what goes into the cache key. No Deno/npm imports -- unit tested with
// Node.
import { localDateOf, localTimeOf, spokenDate, spokenWhen } from './reminderRules.ts';

export type BriefingItem = {
  index: number;
  targetType: 'task' | 'session' | 'memory';
  targetId: string;
  title: string;
  /** overdue | due_today | daily | scheduled_today | pending | snoozed | not_today | upcoming | context */
  reason: string;
  /** now (today) | later | context -- missing means now. */
  bucket?: string;
  dueDate: string | null;
  note: string | null;
  purpose: string;
  nextFireAt: string | null;
  /** When a later item comes back: the snooze end for 'snoozed', else the next reminder. */
  whenAt?: string | null;
  /** The situation of a 'context' reminder ("home"). */
  contextTag?: string | null;
};

/** At most this many items are read out one by one; the rest are only counted. */
export const MAX_SPOKEN_ITEMS = 20;

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
    case 'snoozed':
    case 'upcoming': {
      const at = item.whenAt ?? item.nextFireAt;
      if (at) {
        const w = spokenWhen(new Date(at), tz, today);
        return lang === 'ko' ? `${w.ko}에 알림` : `reminder ${w.en}`;
      }
      if (item.dueDate) {
        const d = spokenDate(item.dueDate, today);
        return lang === 'ko' ? `기한 ${d.ko}` : `due ${d.en}`;
      }
      return lang === 'ko' ? '나중에 알림' : 'later';
    }
    case 'not_today':
      return lang === 'ko' ? '오늘은 쉬고 내일 다시' : 'paused for today';
    case 'context':
      return item.contextTag
        ? lang === 'ko'
          ? `'${clip(item.contextTag, 30)}' 상황일 때`
          : `when: ${clip(item.contextTag, 30)}`
        : lang === 'ko'
          ? '상황 알림'
          : 'for a situation';
    default:
      return '';
  }
}

export function itemLine(item: BriefingItem, lang: TemplateLang, today: string, tz: string): string {
  const label = reasonLabel(item, lang, today, tz);
  return label ? `${clip(item.title, 80)} · ${label}` : clip(item.title, 80);
}

const CLOSING = {
  ko: '끝난 게 있거나, 바꾸거나 새로 추가할 리마인더가 있으면 말씀해 주세요.',
  en: 'Tell me if any of these are done, or if you want to change or add a reminder.',
};

/** The script when there are no reminders at all (no AI needed). */
export function emptyScript(lang: TemplateLang, honorific: string | null): string {
  const h = honorific ? `${honorific}, ` : '';
  if (lang === 'ko') return `${h}지금 등록된 리마인더가 없어요. 새로 추가할 게 있으면 말씀해 주세요.`;
  const text = `${h}you don't have any reminders right now. Tell me if you want to add one.`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function countLine(items: BriefingItem[], lang: TemplateLang, h: string): string {
  const now = items.filter((i) => (i.bucket ?? 'now') === 'now').length;
  const later = items.filter((i) => i.bucket === 'later').length;
  const ctx = items.filter((i) => i.bucket === 'context').length;
  if (lang === 'ko') {
    const parts = [
      now ? `오늘 챙길 것 ${now}개` : '',
      later ? `나중에 알려드릴 것 ${later}개` : '',
      ctx ? `상황에 맞춰 알려드릴 것 ${ctx}개` : '',
    ].filter(Boolean);
    return `${h}리마인더가 모두 ${items.length}개 있어요${parts.length > 1 || now === 0 ? `. ${parts.join(', ')}예요.` : '.'}`;
  }
  const parts = [now ? `${now} for today` : '', later ? `${later} for later` : '', ctx ? `${ctx} for a situation` : ''].filter(Boolean);
  return `${h}you have ${items.length} ${items.length === 1 ? 'reminder' : 'reminders'}${parts.length > 1 || now === 0 ? `: ${parts.join(', ')}.` : '.'}`;
}

/**
 * The deterministic script used when the AI fails: the counts, then every
 * item (up to MAX_SPOKEN_ITEMS) by number with its reason and stored note
 * -- never claiming anything is done -- then an invitation to answer.
 */
export function templateScript(items: BriefingItem[], lang: TemplateLang, honorific: string | null, today: string, tz: string): string {
  if (items.length === 0) return emptyScript(lang, honorific);
  const h = honorific ? `${honorific}, ` : '';
  const parts: string[] = [countLine(items, lang, h)];
  const spoken = items.slice(0, MAX_SPOKEN_ITEMS);
  spoken.forEach((it) => {
    const label = reasonLabel(it, lang, today, tz);
    const note = it.note ? ` ${clip(it.note, 80)}.` : '';
    const num = items.length > 1 ? (lang === 'ko' ? `${it.index}번, ` : `Number ${it.index}, `) : '';
    parts.push(`${num}${clip(it.title, 60)}${label ? `, ${label}` : ''}.${note}`);
  });
  if (items.length > spoken.length) {
    const rest = items.length - spoken.length;
    parts.push(lang === 'ko' ? `그 밖에 ${rest}개가 더 있어요.` : `And ${rest} more.`);
  }
  parts.push(CLOSING[lang]);
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
    v: 2,
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
      i.bucket ?? 'now',
      i.contextTag ?? null,
      i.whenAt ? `${localDateOf(new Date(i.whenAt), p.tz)} ${localTimeOf(new Date(i.whenAt), p.tz)}` : null,
      // Only the local time matters for what is said.
      i.nextFireAt ? `${localDateOf(new Date(i.nextFireAt), p.tz)} ${localTimeOf(new Date(i.nextFireAt), p.tz)}` : null,
    ]),
  });
}
