import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode as NatsErrorCode, headers as natsHeaders, NatsError } from 'nats';
import { NatsConnectionService } from '../nats/nats-connection.service';
import { formatMessagingLog } from '../logging/messaging-log';
import { PROJECT_INSIGHTS_QUERY_SUBJECT } from '../events/subjects';
import { InsightsQueryOutcome, ProjectInsightsResponse } from './insights.types';

const DEFAULT_TIMEOUT_MS = 2_000;

function isValidInsightsResponse(value: unknown): value is ProjectInsightsResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.status === 'not_ready') {
    return typeof record.reason === 'string';
  }
  if (record.status === 'ok') {
    const data = record.data as Record<string, unknown> | undefined;
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.projectId === 'string' &&
      typeof data.generatedAt === 'string' &&
      Array.isArray(data.workloadByAssignee) &&
      Array.isArray(data.countsByStatus)
    );
  }
  return false;
}

/**
 * NestJS/BFF side of the Core NATS request/reply project-insights
 * query (assignment: "use Core NATS request/reply, not JetStream, for
 * this synchronous query" - docs/DECISIONS.md #2). No persistence, no
 * retry-with-backoff: a timeout or missing responder is an acceptable,
 * cheap failure mode for a read query (TM-12) - the caller can just
 * ask again, unlike a lost domain event.
 *
 * Never blocks indefinitely: every call is bounded by
 * INSIGHTS_QUERY_TIMEOUT_MS (default 2s).
 */
@Injectable()
export class InsightsClientService {
  private readonly logger = new Logger(InsightsClientService.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly nats: NatsConnectionService,
    config: ConfigService,
  ) {
    this.timeoutMs = Number(config.get('INSIGHTS_QUERY_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
  }

  async getProjectInsights(
    projectId: string,
    workspaceId: string,
    correlationId: string,
  ): Promise<InsightsQueryOutcome> {
    const start = Date.now();

    if (!this.nats.isConnected()) {
      this.log(correlationId, projectId, 'unavailable_not_connected', start);
      return { status: 'unavailable', reason: 'NATS_NOT_CONNECTED' };
    }

    try {
      const nc = await this.nats.getConnection();
      const h = natsHeaders();
      h.set('X-Correlation-Id', correlationId);
      const payload = JSON.stringify({ projectId, workspaceId, correlationId });

      const msg = await nc.request(PROJECT_INSIGHTS_QUERY_SUBJECT, new TextEncoder().encode(payload), {
        timeout: this.timeoutMs,
        headers: h,
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(msg.data));
      } catch {
        this.log(correlationId, projectId, 'unavailable_malformed', start);
        return { status: 'unavailable', reason: 'MALFORMED_RESPONSE' };
      }

      if (!isValidInsightsResponse(parsed)) {
        this.log(correlationId, projectId, 'unavailable_malformed', start);
        return { status: 'unavailable', reason: 'MALFORMED_RESPONSE' };
      }

      this.log(correlationId, projectId, parsed.status === 'ok' ? 'ok' : 'not_ready', start);
      return parsed;
    } catch (error) {
      if (error instanceof NatsError) {
        if (error.code === (NatsErrorCode.Timeout as string)) {
          this.log(correlationId, projectId, 'pending_timeout', start);
          return { status: 'pending', reason: 'TIMEOUT' };
        }
        if (error.code === (NatsErrorCode.NoResponders as string)) {
          this.log(correlationId, projectId, 'unavailable_no_responder', start);
          return { status: 'unavailable', reason: 'NO_RESPONDER' };
        }
      }
      this.log(correlationId, projectId, 'unavailable_error', start);
      return { status: 'unavailable', reason: 'ERROR' };
    }
  }

  private log(correlationId: string, projectId: string, result: string, start: number): void {
    this.logger.log(
      formatMessagingLog({
        service: 'management-service',
        correlationId,
        subject: PROJECT_INSIGHTS_QUERY_SUBJECT,
        aggregateId: projectId,
        latencyMs: Date.now() - start,
        result,
      }),
    );
  }
}
