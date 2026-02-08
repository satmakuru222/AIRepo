import Anthropic from '@anthropic-ai/sdk';
import { config } from '../shared/config.js';
import { createChildLogger } from '../shared/logger.js';
import type { ExtractionResult, DraftResult } from '../shared/types.js';

const log = createChildLogger('claude');

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// ─── Extraction prompt ──────────────────────────────────────────────────────

const EXTRACTION_SYSTEM = `You are a follow-up task extraction assistant. Your job is to extract structured data from a user's natural language message about a follow-up they want to schedule.

Rules:
- Extract the due date/time, who to contact, and the context/reason.
- If the user does NOT specify a clear date or the date is ambiguous (e.g., "sometime next week" without a day), set needs_clarification=true and provide a short, friendly clarifying question.
- If the user says something like "next Friday morning", interpret it relative to the current date provided.
- Default action_type to "remind_and_draft" unless the user explicitly says "just remind me" (remind) or "send it for me" (send).
- contact_hint should be the person/entity to follow up with.
- context should be a concise summary of what the follow-up is about.
- NEVER include any PII, passwords, or sensitive information in your output.
- Respond ONLY with valid JSON matching the schema below. No markdown, no explanation.

JSON schema:
{
  "needs_clarification": boolean,
  "clarifying_question": string (empty string if not needed),
  "due_at_iso": string|null (ISO 8601 with timezone, null if needs clarification),
  "action_type": "remind"|"remind_and_draft"|"send",
  "contact_hint": string,
  "context": string
}`;

export async function extractFollowUp(
  messageText: string,
  userTimezone: string,
  currentDateIso: string,
): Promise<ExtractionResult> {
  log.info({ textLength: messageText.length }, 'Calling Claude for extraction');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Current date/time: ${currentDateIso}\nUser timezone: ${userTimezone}\n\nUser message:\n${messageText}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  log.debug({ raw: text }, 'Claude extraction raw response');

  try {
    const parsed = JSON.parse(text) as ExtractionResult;
    return parsed;
  } catch (err) {
    log.error({ err, raw: text }, 'Failed to parse Claude extraction response');
    // Fallback: ask for clarification
    return {
      needs_clarification: true,
      clarifying_question:
        "I had trouble understanding your request. Could you rephrase it? For example: 'Follow up with Dr. Smith next Friday morning about test results.'",
      due_at_iso: null,
      action_type: 'remind_and_draft',
      contact_hint: '',
      context: messageText,
    };
  }
}

// ─── Drafting prompt ────────────────────────────────────────────────────────

const DRAFTING_SYSTEM = `You are a professional message drafting assistant. Draft a short, polite follow-up message based on the context provided.

Rules:
- Keep it under 100 words.
- Match the requested tone (friendly, formal, or brief).
- Include a clear subject line.
- NEVER include any PII, passwords, or sensitive information.
- Respond ONLY with valid JSON. No markdown, no explanation.

JSON schema:
{
  "subject": string,
  "body": string
}`;

export async function draftFollowUp(
  contactHint: string,
  context: string,
  tone: string,
): Promise<DraftResult> {
  log.info({ contactHint }, 'Calling Claude for drafting');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: DRAFTING_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Contact: ${contactHint}\nContext: ${context}\nTone: ${tone}\n\nDraft a follow-up message.`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  log.debug({ raw: text }, 'Claude draft raw response');

  try {
    return JSON.parse(text) as DraftResult;
  } catch (err) {
    log.error({ err, raw: text }, 'Failed to parse Claude draft response');
    return {
      subject: `Follow up: ${contactHint}`,
      body: `Hi, I wanted to follow up regarding ${context}. Could you please provide an update? Thank you!`,
    };
  }
}
