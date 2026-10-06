export function formatIssueKey(projectKey: string, seq: number): string {
  return `${projectKey}-${seq}`;
}
