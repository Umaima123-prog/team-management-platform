import {
  RANK_GAP,
  appendRank,
  initialRank,
  needsRebalance,
  rankBetween,
  rebalancedRanks,
} from './rank.util';

describe('rank.util', () => {
  it('initialRank starts at the gap', () => {
    expect(initialRank()).toBe(RANK_GAP);
  });

  it('appendRank adds a gap after the current max', () => {
    expect(appendRank(null)).toBe(RANK_GAP);
    expect(appendRank(1024)).toBe(2048);
  });

  it('rankBetween handles both ends empty (first item in column)', () => {
    expect(rankBetween(null, null)).toBe(RANK_GAP);
  });

  it('rankBetween handles moving to the top (no before)', () => {
    expect(rankBetween(null, 1024)).toBe(512);
  });

  it('rankBetween handles moving to the bottom (no after)', () => {
    expect(rankBetween(1024, null)).toBe(1024 + RANK_GAP);
  });

  it('rankBetween picks the midpoint between two neighbors', () => {
    expect(rankBetween(1024, 2048)).toBe(1536);
  });

  it('needsRebalance is false when there is room between neighbors', () => {
    expect(needsRebalance(1024, 2048)).toBe(false);
  });

  it('needsRebalance is false at either open end', () => {
    expect(needsRebalance(null, 2048)).toBe(false);
    expect(needsRebalance(1024, null)).toBe(false);
  });

  it('needsRebalance is true once ranks have collapsed (no float room left)', () => {
    // Two floats so close together their average rounds to one of them.
    const before = 1;
    const after = before + Number.EPSILON;
    expect(needsRebalance(before, after)).toBe(true);
  });

  it('rebalancedRanks evenly re-spaces an ordered list from scratch', () => {
    const ranks = rebalancedRanks(['a', 'b', 'c']);
    expect(ranks.get('a')).toBe(RANK_GAP);
    expect(ranks.get('b')).toBe(RANK_GAP * 2);
    expect(ranks.get('c')).toBe(RANK_GAP * 3);
  });
});
