import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';

/**
 * Inbox is gone as its own concept -- absorbed into Topics' "Unclassified"
 * view (see app/topic.tsx), which covers the same ground (tasks/
 * ideas with no topic yet) plus sessions that were never classified at
 * all. This route stays registered so an old link/shortcut still lands
 * somewhere real instead of a dead screen.
 */
export default function InboxRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/topic?unclassified=1');
  }, [router]);
  return null;
}
