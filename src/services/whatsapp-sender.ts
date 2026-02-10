import { config } from '../shared/config.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('whatsapp-sender');

const BASE_URL = 'https://graph.facebook.com/v21.0';

export interface SendWhatsAppParams {
  to: string; // phone number in international format, e.g. 15551234567
  body: string;
}

export async function sendWhatsApp(params: SendWhatsAppParams): Promise<{ messageId: string }> {
  log.info({ to: params.to }, 'Sending WhatsApp message');

  const url = `${BASE_URL}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'text',
      text: { body: params.body },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    log.error({ status: response.status, body: errBody }, 'WhatsApp send failed');
    throw new Error(`WhatsApp API error: ${response.status} - ${errBody}`);
  }

  const data = (await response.json()) as { messages: Array<{ id: string }> };
  const messageId = data.messages?.[0]?.id ?? 'unknown';
  log.info({ messageId }, 'WhatsApp message sent successfully');
  return { messageId };
}
