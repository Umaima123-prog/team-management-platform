/**
 * One structured log line shape shared by every messaging-related log
 * statement (relay, insights client) - the assignment's required
 * traceability fields: service, correlationId, eventId, aggregateId,
 * subject, attempt, latency, result (section 13 "Traceability").
 * Never includes payload content or secrets.
 */
export interface MessagingLogFields {
  service: 'management-service';
  correlationId?: string;
  eventId?: string;
  aggregateId?: string;
  subject?: string;
  attempt?: number;
  latencyMs?: number;
  result: string;
  [extra: string]: unknown;
}

export function formatMessagingLog(fields: MessagingLogFields): string {
  return JSON.stringify(fields);
}
