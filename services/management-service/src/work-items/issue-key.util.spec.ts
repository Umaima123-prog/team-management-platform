import { formatIssueKey } from './issue-key.util';

describe('formatIssueKey', () => {
  it('joins the project key and sequence with a hyphen', () => {
    expect(formatIssueKey('PAY', 104)).toBe('PAY-104');
    expect(formatIssueKey('ABC', 1)).toBe('ABC-1');
  });
});
