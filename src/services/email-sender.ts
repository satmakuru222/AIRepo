import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { config } from '../shared/config.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('email-sender');

const ses = new SESClient({
  region: config.AWS_REGION,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
});

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
}

export async function sendEmail(params: SendEmailParams): Promise<{ messageId: string }> {
  log.info({ to: params.to, subject: params.subject }, 'Sending email via SES');

  const command = new SendEmailCommand({
    Source: config.SES_FROM_EMAIL,
    Destination: {
      ToAddresses: [params.to],
    },
    Message: {
      Subject: { Data: params.subject, Charset: 'UTF-8' },
      Body: {
        Text: { Data: params.body, Charset: 'UTF-8' },
      },
    },
  });

  const result = await ses.send(command);
  const messageId = result.MessageId ?? 'unknown';
  log.info({ messageId }, 'Email sent successfully');
  return { messageId };
}
