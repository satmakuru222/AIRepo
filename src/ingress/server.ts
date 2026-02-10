import Fastify from 'fastify';
import { config } from '../shared/config.js';
import { createChildLogger } from '../shared/logger.js';
import { emailRoutes } from './routes/email.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { AppError } from '../shared/errors.js';

const log = createChildLogger('ingress');

async function main() {
  const app = Fastify({
    logger: false, // We use our own pino instance
    bodyLimit: 1_048_576, // 1 MB
  });

  // ─── Global error handler ─────────────────────────────────────────
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      log.warn({ code: error.code, message: error.message }, 'App error');
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }
    log.error({ err: error }, 'Unhandled error');
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  // ─── Health check ─────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // ─── Register routes ──────────────────────────────────────────────
  await app.register(emailRoutes);
  await app.register(whatsappRoutes);

  // ─── Start ────────────────────────────────────────────────────────
  await app.listen({ port: config.INGRESS_PORT, host: '0.0.0.0' });
  log.info({ port: config.INGRESS_PORT }, 'Ingress server started');

  // ─── Graceful shutdown ────────────────────────────────────────────
  const shutdown = async () => {
    log.info('Shutting down ingress server…');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'Failed to start ingress server');
  process.exit(1);
});
