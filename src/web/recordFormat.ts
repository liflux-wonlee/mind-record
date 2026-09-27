/** Display helpers shared by the web records list and detail pages. */
import { sessionModeLabel, type Session } from '@/services/sessions';

export function formatRecordDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** 'note' reads as "Typed note"; the voice modes as their own name. */
export function modeLabel(mode: string): string {
  return sessionModeLabel(mode);
}

export function statusLabel(status: Session['processing_status']): string | null {
  if (status === 'done') return null;
  if (status === 'error') return 'Processing failed';
  return 'Processing…';
}
