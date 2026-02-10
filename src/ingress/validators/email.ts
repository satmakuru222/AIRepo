import { createHmac } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../../shared/config.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('email-validator');

/**
 * Validates inbound email webhook signature.
 * Supports HMAC-SHA256 signature in X-Webhook-Signature header.
 * Pluggable: replace this function for different email providers.
 */
export function validateEmailWebhook(request: FastifyRequest): void {
  if (!config.EMAIL_WEBHOOK_SECRET) {
    log.warn('EMAIL_WEBHOOK_SECRET not set – skipping validation (dev mode only)');
    return;
  }

  const signature = request.headers['x-webhook-signature'] as string | undefined;
  if (!signature) {
    throw new UnauthorizedError('Missing X-Webhook-Signature header');
  }

  const rawBody = JSON.stringify(request.body);
  const expected = createHmac('sha256', config.EMAIL_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (signature !== expected) {
    log.warn('Email webhook signature mismatch');
    throw new UnauthorizedError('Invalid webhook signature');
  }
}
