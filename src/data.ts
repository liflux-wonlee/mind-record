/**
 * Account preferences — the one remaining piece of prototype-only mock
 * content. Nothing here writes to a real setting yet (see
 * app/(tabs)/account.tsx); tasks, inbox, journal, calendar, sessions, and
 * topics all moved to real Supabase-backed services and no longer read
 * from this file.
 */

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
