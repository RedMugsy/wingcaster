/**
 * Line-based diff for the version-history view.
 *
 * Implemented as a Longest Common Subsequence walk on the line arrays.
 * O(n·m) time and memory, which is fine for template bodies (kilobytes
 * of text; low hundreds of lines at worst). Emits the classic "removed
 * / added / unchanged" row sequence a rendering component consumes
 * without needing to know the algorithm.
 *
 * NOT a fancy diff — no whitespace-only detection, no move-block
 * recognition, no semantic hunks. If a template ever needs those, swap
 * in `diff` from npm; the signature `computeLineDiff(a, b) → DiffRow[]`
 * is the contract callers depend on.
 */

export type DiffRowKind = 'unchanged' | 'added' | 'removed'

export interface DiffRow {
  kind: DiffRowKind
  text: string
}

/**
 * Split a body into lines for diffing. `\r\n` is normalised to `\n` so
 * a template edited in a Windows editor doesn't diff against one edited
 * on a Mac purely because of line endings.
 */
function splitLines(source: string): string[] {
  if (source === '') return []
  return source.replace(/\r\n/g, '\n').split('\n')
}

/**
 * LCS length table. `dp[i][j]` = length of the LCS of the first i lines
 * of `left` and the first j lines of `right`. Rows are added lazily
 * (Array of Uint16Array would be faster; the readability trade is not
 * worth it for at most a few hundred lines).
 */
function buildLcsTable(left: string[], right: string[]): number[][] {
  const n = left.length
  const m = right.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  return dp
}

/**
 * Walk the LCS table backwards to emit rows in order. Ties (both moves
 * yield the same LCS length) prefer emitting removed before added,
 * which matches most diff tools' output when a block is fully replaced.
 */
export function computeLineDiff(leftSource: string, rightSource: string): DiffRow[] {
  const left = splitLines(leftSource)
  const right = splitLines(rightSource)

  if (leftSource === rightSource) {
    return left.map((text) => ({ kind: 'unchanged', text }))
  }
  if (left.length === 0) {
    return right.map((text) => ({ kind: 'added', text }))
  }
  if (right.length === 0) {
    return left.map((text) => ({ kind: 'removed', text }))
  }

  const dp = buildLcsTable(left, right)
  const rows: DiffRow[] = []
  let i = left.length
  let j = right.length

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) {
      rows.push({ kind: 'unchanged', text: left[i - 1] })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rows.push({ kind: 'added', text: right[j - 1] })
      j -= 1
    } else {
      rows.push({ kind: 'removed', text: left[i - 1] })
      i -= 1
    }
  }

  return rows.reverse()
}
