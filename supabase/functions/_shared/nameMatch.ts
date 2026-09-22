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
export function findSimilarName<T extends { name: string }>(
  candidates: T[],
  name: string,
  opts: { shortNames?: boolean } = {}
): T | null {
  const target = normalizeName(name);
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const candidate = normalizeName(c.name);
    if (candidate === target) continue;
    // Containment counts for names of 3+ characters. With `shortNames`, also
    // for 2-character names (common in Korean: "가족" / "가족여행") when the
    // shorter one is at least half the longer one -- only for callers that
    // ASK the user about a match rather than silently skipping on one.
    const shorter = Math.min(candidate.length, target.length);
    const longer = Math.max(candidate.length, target.length);
    const contains =
      (shorter >= 3 || (opts.shortNames === true && shorter === 2 && shorter / longer >= 0.5)) &&
      (candidate.includes(target) || target.includes(candidate));
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

/**
 * Up to `limit` candidates loosely resembling `name`, closest first -- for
 * "did you mean ...?" follow-ups. Looser than findSimilarName: this only
 * offers options to ask about, it never decides anything by itself.
 */
export function closestNames<T extends { name: string }>(candidates: T[], name: string, limit = 3): T[] {
  const target = normalizeName(name);
  return candidates
    .map((c) => {
      const candidate = normalizeName(c.name);
      const distance = levenshtein(candidate, target);
      const maxLen = Math.max(candidate.length, target.length) || 1;
      const contains = candidate.includes(target) || target.includes(candidate);
      return { c, score: contains ? 0 : distance / maxLen };
    })
    .filter((x) => x.score <= 0.5)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.c);
}
