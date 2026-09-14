/**
 * Prototype content — lifted verbatim from the design's `renderVals()` so the
 * screens read exactly as they do in the handoff. UI chrome is English,
 * captured content is Korean, per the brief.
 *
 * Tasks used to be mocked here too; they now come from Supabase — see
 * `src/services/tasks.ts` and `src/hooks/useTasks.ts`.
 */

export type InboxItem = {
  type: string;
  topic: string;
  title: string;
  review: boolean;
  note?: string;
  aLabel?: string;
  bLabel?: string;
};

export const inboxItems: InboxItem[] = [
  { type: 'Idea', topic: 'Business · Liflux', title: '서비스 계약 월 구독 모델', review: false },
  { type: 'Task · Tomorrow', topic: 'David', title: 'David에게 전화', review: false },
  {
    type: 'Possible action',
    topic: 'Business',
    title: '홈페이지 가격 변경',
    review: true,
    note: 'Website pricing을 변경할 계획이라고 언급했습니다.',
    aLabel: 'Create task',
    bLabel: 'Keep as idea',
  },
  {
    type: 'Needs topic',
    topic: 'Liflux / JoaSuite',
    title: 'JoaSuite에서 Liflux 서비스 업무 관리',
    review: true,
    note: '이 내용은 Liflux와 JoaSuite 둘 다 관련 있어 보입니다.',
    aLabel: 'Both',
    bLabel: 'JoaSuite only',
  },
  { type: 'Task', topic: 'Faith · Bible Study', title: '로마서 8장 다시 공부', review: false },
  { type: 'Event · Tue 2 PM', topic: 'David', title: 'Meeting with David', review: false },
];

/** Conversations per day of September 2026, keyed by day-of-month. */
export type Conversation = {
  time: string;
  mode: string;
  topic: string;
  title: string;
  meta: string;
  /** Route the row opens. */
  to: '/tasks' | '/topic' | '/journal' | '/thread' | '/summary';
};

export const conversationsByDay: Record<number, Conversation[]> = {
  3: [
    {
      time: '8:02 AM',
      mode: 'Capture',
      topic: 'Business · Liflux',
      title: 'Alarm license 알아보기',
      meta: '1 task',
      to: '/tasks',
    },
  ],
  8: [
    {
      time: '9:40 AM',
      mode: 'Conversation',
      topic: 'Business · JoaSuite',
      title: 'Onboarding 단계 축소',
      meta: '1 idea · 1 open question',
      to: '/topic',
    },
  ],
  10: [
    {
      time: '7:15 PM',
      mode: 'Capture',
      topic: 'Personal · Family',
      title: '주말 새 사무실 방문',
      meta: '1 event',
      to: '/journal',
    },
  ],
  11: [
    {
      time: '8:10 AM',
      mode: 'Capture',
      topic: 'Business · Liflux',
      title: '서비스 계약 월 구독 모델',
      meta: '1 idea · 1 task',
      to: '/thread',
    },
    {
      time: '12:30 PM',
      mode: 'Conversation',
      topic: 'Business · JoaSuite',
      title: 'Subscription Service — final direction',
      meta: '1 decision',
      to: '/thread',
    },
    {
      time: '9:05 PM',
      mode: 'Reflection',
      topic: 'Faith · Bible Study',
      title: '로마서 8장',
      meta: '1 insight · 1 task',
      to: '/journal',
    },
  ],
  12: [
    {
      time: '8:14 AM',
      mode: 'Capture',
      topic: 'Business · Liflux',
      title: 'David 통화, 월 구독, 로마서 8장',
      meta: '2 ideas · 2 tasks',
      to: '/summary',
    },
  ],
};

/* ── Account preferences ───────────────────────────────────────────────── */

export type PrefRow =
  | { kind: 'toggle'; key: string; label: string; sub: string; default: boolean }
  | { kind: 'value'; label: string; sub: string; value: string };

export type PrefGroup = { name: string; rows: PrefRow[] };

export const prefGroups: PrefGroup[] = [
  {
    name: 'Voice & AI',
    rows: [
      { kind: 'value', label: 'Default mode', sub: '앱을 열 때 시작하는 모드', value: 'Capture' },
      { kind: 'value', label: 'Response length', sub: 'AI가 대답하는 길이', value: 'Short' },
      { kind: 'value', label: 'Language', sub: '음성 인식 · UI', value: 'English' },
      {
        kind: 'toggle',
        key: 'autoDrive',
        label: 'Auto driving mode',
        sub: '차량 Bluetooth 연결 시 자동 전환',
        default: true,
      },
    ],
  },
  {
    name: 'Privacy',
    rows: [
      {
        kind: 'toggle',
        key: 'audio',
        label: 'Keep audio recordings',
        sub: '끄면 transcript만 보관',
        default: false,
      },
      { kind: 'value', label: 'Transcript retention', sub: '원본 대화 보관 기간', value: '1 year' },
      { kind: 'value', label: 'Private topics', sub: 'AI 검색·학습에서 제외', value: 'Faith · Family' },
      { kind: 'toggle', key: 'faceid', label: 'Lock with Face ID', sub: '앱을 열 때 인증', default: true },
    ],
  },
  {
    name: 'Connections',
    rows: [
      { kind: 'value', label: 'Calendar', sub: 'Event를 자동 추가', value: 'Google' },
      { kind: 'value', label: 'Car audio', sub: 'CarPlay · Android Auto', value: 'Not set' },
    ],
  },
  {
    name: 'Notifications',
    rows: [
      {
        kind: 'toggle',
        key: 'ctxReminder',
        label: 'Contextual reminders',
        sub: '“어제 David 통화 얘기하셨죠”',
        default: true,
      },
      {
        kind: 'toggle',
        key: 'dailyDigest',
        label: 'Daily journal at night',
        sub: '9:00 PM',
        default: true,
      },
      {
        kind: 'toggle',
        key: 'rediscover',
        label: 'Rediscover old ideas',
        sub: '주 1회',
        default: false,
      },
    ],
  },
];
