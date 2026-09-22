// Near-duplicate name detection for topics and task lists, shared by
// process-session (after a conversation) and converse's live tools (during
// one), so both refuse to silently create "Familys" next to "Family" by the
// same rule.

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/**
 * The closest candidate whose name is close to `name` -- one containing the
 * other, or within 30% edit distance -- but NOT the same name (an exact
 * match is the caller's job to handle, by reusing it outright).
 */
export function findSimilarName<T extends { name: string }>(candidates: T[], name: string): T | null {
  const target = normalizeName(name);
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const candidate = normalizeName(c.name);
    if (candidate === target) continue;
    const contains =
      candidate.length > 2 && target.length > 2 && (candidate.includes(target) || target.includes(candidate));
    const distance = levenshtein(candidate, target);
    const maxLen = Math.max(candidate.length, target.length);
    const closeEnough = contains || (maxLen > 0 && distance / maxLen <= 0.3);
    if (closeEnough && distance < bestDistance) {
      best = c;
      bestDistance = distance;
    }
  }
  return best;
}
