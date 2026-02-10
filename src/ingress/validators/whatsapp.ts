import { createHmac } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../../shared/config.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('whatsapp-validator');

/**
 * Validates Meta WhatsApp Cloud API webhook signature.
 * Uses X-Hub-Signature-256 header with HMAC-SHA256.
 */
export function validateWhatsAppWebhook(request: FastifyRequest): void {
  if (!config.WHATSAPP_APP_SECRET) {
    log.warn('WHATSAPP_APP_SECRET not set – skipping validation (dev mode only)');
    return;
  }

  const signature = request.headers['x-hub-signature-256'] as string | undefined;
  if (!signature) {
    throw new UnauthorizedError('Missing X-Hub-Signature-256 header');
  }

  const rawBody = JSON.stringify(request.body);
  const expected =
    'sha256=' +
    createHmac('sha256', config.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');

  if (signature !== expected) {
    log.warn('WhatsApp webhook signature mismatch');
    throw new UnauthorizedError('Invalid webhook signature');
  }
}
