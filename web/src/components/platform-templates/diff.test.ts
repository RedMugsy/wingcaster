/**
 * Unit tests for the line-diff helper used by VersionsTab.
 *
 * The version-history diff is presented to admins mid-edit; getting it
 * subtly wrong (dropping a line, misattributing changed content as
 * "unchanged") is exactly the kind of thing that makes the tab
 * untrustworthy. These cases assert the properties the rendering code
 * silently depends on.
 */
import { describe, expect, it } from 'vitest'
import { computeLineDiff, type DiffRow } from './diff'

function kinds(rows: DiffRow[]): string {
  return rows.map((r) => r.kind[0]).join('')
}

function texts(rows: DiffRow[], kind: DiffRow['kind']): string[] {
  return rows.filter((r) => r.kind === kind).map((r) => r.text)
}

describe('identical inputs', () => {
  it('returns every line as unchanged', () => {
    const rows = computeLineDiff('foo\nbar\nbaz', 'foo\nbar\nbaz')
    expect(kinds(rows)).toBe('uuu')
    expect(texts(rows, 'unchanged')).toEqual(['foo', 'bar', 'baz'])
  })

  it('handles empty-string == empty-string', () => {
    expect(computeLineDiff('', '')).toEqual([])
  })

  it('normalises \\r\\n line endings so a Windows vs Mac edit is not a diff', () => {
    const rows = computeLineDiff('one\r\ntwo\r\nthree', 'one\ntwo\nthree')
    expect(rows.every((r) => r.kind === 'unchanged')).toBe(true)
  })
})

describe('additions only', () => {
  it('marks all lines as added when the left side is empty', () => {
    const rows = computeLineDiff('', 'x\ny')
    expect(kinds(rows)).toBe('aa')
    expect(texts(rows, 'added')).toEqual(['x', 'y'])
  })

  it('inserts a new line between two unchanged ones', () => {
    const rows = computeLineDiff('a\nc', 'a\nb\nc')
    expect(kinds(rows)).toBe('uau')
    expect(texts(rows, 'added')).toEqual(['b'])
    expect(texts(rows, 'unchanged')).toEqual(['a', 'c'])
  })
})

describe('removals only', () => {
  it('marks all lines as removed when the right side is empty', () => {
    const rows = computeLineDiff('x\ny', '')
    expect(kinds(rows)).toBe('rr')
    expect(texts(rows, 'removed')).toEqual(['x', 'y'])
  })

  it('deletes a middle line', () => {
    const rows = computeLineDiff('a\nb\nc', 'a\nc')
    expect(kinds(rows)).toBe('uru')
    expect(texts(rows, 'removed')).toEqual(['b'])
  })
})

describe('substitution (removed + added)', () => {
  it('emits removed BEFORE added for a full-line replacement', () => {
    // Convention: when a line is replaced, most diff tools show the old
    // line struck through above the new line — this makes the "removed
    // before added" property visible.
    const rows = computeLineDiff('a\nOLD\nc', 'a\nNEW\nc')
    expect(kinds(rows)).toBe('urau')
    expect(texts(rows, 'removed')).toEqual(['OLD'])
    expect(texts(rows, 'added')).toEqual(['NEW'])
  })

  it('handles multi-line substitution', () => {
    const rows = computeLineDiff('a\nOLD1\nOLD2\nc', 'a\nNEW1\nNEW2\nc')
    expect(texts(rows, 'removed')).toEqual(['OLD1', 'OLD2'])
    expect(texts(rows, 'added')).toEqual(['NEW1', 'NEW2'])
    // Unchanged lines stay in position.
    expect(rows[0]).toEqual({ kind: 'unchanged', text: 'a' })
    expect(rows[rows.length - 1]).toEqual({ kind: 'unchanged', text: 'c' })
  })
})

describe('interleaved changes', () => {
  it('preserves stable lines and marks the changes', () => {
    const rows = computeLineDiff(
      'alpha\nbeta\ngamma\ndelta',
      'alpha\nBETA\ngamma\nDELTA\nepsilon',
    )
    expect(texts(rows, 'unchanged')).toEqual(['alpha', 'gamma'])
    expect(texts(rows, 'removed')).toEqual(['beta', 'delta'])
    expect(texts(rows, 'added')).toEqual(['BETA', 'DELTA', 'epsilon'])
  })
})

describe('empty lines', () => {
  it('treats a blank line as a real line', () => {
    const rows = computeLineDiff('a\n\nb', 'a\n\nb')
    expect(kinds(rows)).toBe('uuu')
    expect(rows[1]).toEqual({ kind: 'unchanged', text: '' })
  })

  it('detects a blank-line insertion', () => {
    const rows = computeLineDiff('a\nb', 'a\n\nb')
    expect(texts(rows, 'added')).toEqual([''])
  })
})

describe('single-line inputs', () => {
  it('handles two different single-line inputs as remove+add', () => {
    const rows = computeLineDiff('hello', 'world')
    expect(kinds(rows)).toBe('ra')
  })

  it('handles single identical lines', () => {
    const rows = computeLineDiff('same', 'same')
    expect(kinds(rows)).toBe('u')
  })
})
