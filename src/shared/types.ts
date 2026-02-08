// ─── Queue job payloads ─────────────────────────────────────────────────────

export interface IngestJobPayload {
  inboundId: string;
  userId: string;
}

export interface ExecuteJobPayload {
  taskId: string;
}

// ─── Claude extraction result ───────────────────────────────────────────────

export interface ExtractionResult {
  needs_clarification: boolean;
  clarifying_question: string;
  due_at_iso: string | null;
  action_type: 'remind' | 'remind_and_draft' | 'send';
  contact_hint: string;
  context: string;
}

// ─── Claude draft result ────────────────────────────────────────────────────

export interface DraftResult {
  subject: string;
  body: string;
}

// ─── Outbox payload ─────────────────────────────────────────────────────────

export interface OutboxPayload {
  to: string;
  subject?: string;
  body: string;
  [key: string]: string | undefined;
}

// ─── Channel type ───────────────────────────────────────────────────────────

export type Channel = 'email' | 'whatsapp';

// ─── Action type ────────────────────────────────────────────────────────────

export type ActionType = 'remind' | 'remind_and_draft' | 'send';

// ─── Task status ────────────────────────────────────────────────────────────

export type TaskStatus =
  | 'pending'
  | 'needs_clarification'
  | 'due'
  | 'executing'
  | 'sending'
  | 'done'
  | 'failed';

// ─── Webhook payloads ───────────────────────────────────────────────────────

export interface EmailWebhookPayload {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  textBody: string;
  timestamp: string;
}

export interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: { phone_number_id: string };
      messages?: Array<{
        id: string;
        from: string;
        timestamp: string;
        type: string;
        text?: { body: string };
      }>;
    };
  }>;
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppWebhookEntry[];
}
