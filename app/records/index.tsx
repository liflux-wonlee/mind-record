/**
 * Web: the signed-in user's recordings, newest first, read-only (see
 * docs/WEB_PREPARATION.md). Only reachable in the web build -- the root
 * navigator keeps it out of the mobile app, which has its own Records tab.
 *
 * Reads the same `sessions` rows the phone app writes, through the same
 * RLS, with a list-only column set (no transcript) and the same
 * (started_at, id) paging as the mobile Records list.
 */
import { Link } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { friendlyMessage } from '@/lib/friendlyError';
import { useAuth } from '@/providers/AuthProvider';
import { listSessionItemsPage, type SessionListItem } from '@/services/sessions';
import { colors, font, h2, radius } from '@/theme';
import { formatRecordDate, modeLabel, statusLabel } from '@/web/recordFormat';
import { WebPage } from '@/web/WebPage';

const PAGE_SIZE = 20;

const CARD_COLORS = [
  colors.pastelPink,
  colors.pastelBlue,
  colors.pastelGreen,
  colors.pastelYellow,
  colors.pastelLavender,
  colors.pastelPeach,
];

export default function RecordsListScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // Drops a response that arrives after a newer load started (Refresh
  // clicked twice, or sign-out while a page was in flight).
  const requestRef = useRef(0);

  const loadFirst = useCallback(async () => {
    if (!user) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listSessionItemsPage(user.id, { limit: PAGE_SIZE });
      if (request !== requestRef.current) return;
      setItems(page);
      setHasMore(page.length === PAGE_SIZE);
    } catch (e) {
      if (request !== requestRef.current) return;
      setError(friendlyMessage(e, 'Could not load your recordings.'));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadFirst();
    return () => {
      requestRef.current++;
    };
  }, [loadFirst]);

  const loadMore = async () => {
    if (!user || loadingMore || items.length === 0) return;
    const last = items[items.length - 1];
    const request = requestRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listSessionItemsPage(user.id, {
        before: { startedAt: last.started_at, id: last.id },
        limit: PAGE_SIZE,
      });
      if (request !== requestRef.current) return;
      setItems((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (e) {
      if (request !== requestRef.current) return;
      setError(friendlyMessage(e, 'Could not load more recordings.'));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <WebPage>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Records</Text>
        <Button variant="ghost" label="Refresh" disabled={loading} onPress={loadFirst} />
      </View>
      <Text style={styles.note}>
        Read-only on the web for now. Recording, conversations and editing are in the Mind Record app.
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : error && items.length === 0 ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{error}</Text>
          <Button variant="save" label="Try again" onPress={loadFirst} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>No recordings yet. Ones you make in the app will show up here.</Text>
        </View>
      ) : (
        <View>
          {items.map((item, i) => {
            const status = statusLabel(item.processing_status);
            return (
              <Link key={item.id} href={`/records/${item.id}`} asChild>
                {/* One flattened style object: Link asChild hands the child's
                    style straight to the <a>, which can't take an array
                    (it crashed the page) or a function (it was dropped). */}
                <Pressable
                  accessibilityRole="link"
                  style={StyleSheet.flatten([styles.card, { backgroundColor: CARD_COLORS[i % CARD_COLORS.length] }])}
                >
                  <Text style={styles.meta}>
                    {formatRecordDate(item.started_at)} · {modeLabel(item.mode)}
                    {status ? ` · ${status}` : ''}
                  </Text>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.title ?? 'Untitled recording'}
                  </Text>
                  {item.summary ? (
                    <Text style={styles.summary} numberOfLines={2}>
                      {item.summary}
                    </Text>
                  ) : null}
                </Pressable>
              </Link>
            );
          })}
          {error ? <Text style={styles.inlineError}>{error}</Text> : null}
          {hasMore ? (
            <Button
              variant="secondary"
              label={loadingMore ? 'Loading…' : 'Load more'}
              disabled={loadingMore}
              onPress={loadMore}
              style={{ alignSelf: 'center', marginTop: 8, borderRadius: radius.pastel, paddingHorizontal: 24 }}
            />
          ) : null}
        </View>
      )}
    </WebPage>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...h2,
  },
  note: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.neutral700,
    marginTop: 4,
    marginBottom: 16,
  },
  stateBox: {
    gap: 12,
    padding: 16,
    borderRadius: radius.pastel,
    backgroundColor: colors.surface,
  },
  stateText: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  card: {
    padding: 14,
    marginBottom: 10,
    borderRadius: radius.pastel,
  },
  meta: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: colors.neutral700,
  },
  cardTitle: {
    fontFamily: font.extrabold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    marginTop: 4,
  },
  summary: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.neutral800,
    marginTop: 4,
  },
  inlineError: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.accent700,
    marginTop: 4,
  },
});
