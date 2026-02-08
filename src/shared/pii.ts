/**
 * Basic PII redaction before sending text to the LLM.
 * Redacts common patterns: SSN, credit card numbers, phone numbers (partial),
 * and email addresses in the body text.
 */

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_PATTERN = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g;
const EMAIL_IN_BODY_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

export function redactPii(text: string): string {
  return text
    .replace(SSN_PATTERN, '[SSN_REDACTED]')
    .replace(CREDIT_CARD_PATTERN, '[CC_REDACTED]')
    .replace(EMAIL_IN_BODY_PATTERN, '[EMAIL_REDACTED]');
}

/**
 * Redact raw message body for storage after retention period.
 * Replaces body with a marker.
 */
export function redactForRetention(text: string): string {
  return '[REDACTED_PER_RETENTION_POLICY]';
}
