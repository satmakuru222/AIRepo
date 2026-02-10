# Follow-Up Concierge

A production-grade system that accepts messages from **Email** and **WhatsApp**, extracts follow-up tasks (due time + context) using Claude AI, stores them, and sends reminders/drafts at the right time.

## Architecture

```
┌────────────────┐   ┌────────────────┐
│  Email Webhook │   │WhatsApp Webhook│
└───────┬────────┘   └───────┬────────┘
        │                    │
        └───────┬────────────┘
                │
        ┌───────▼────────┐
        │ Ingress Service│  (Fastify – validates, deduplicates, enqueues)
        └───────┬────────┘
                │  BullMQ
        ┌───────▼────────┐
        │  Ingest Worker │  (calls Claude to extract task JSON)
        └───────┬────────┘
                │  Postgres
        ┌───────▼─────────┐
        │Scheduler Worker │  (cron – scans due tasks every minute)
        └───────┬─────────┘
                │  BullMQ
        ┌───────▼─────────┐
        │ Executor Worker │  (calls Claude to draft message)
        └───────┬─────────┘
                │  Postgres outbox
        ┌───────▼────────┐
        │ Outbox Sender  │  (polls outbox, sends via SES/WhatsApp API)
        └────────────────┘
```

### Key design decisions

| Decision | Rationale |
|----------|-----------|
| **Redis + BullMQ** over RabbitMQ | Simpler ops (no Erlang), native delayed jobs, built-in retry/backoff/DLQ, also serves as cache |
| **Outbox pattern** | Never lose a notification due to partial failure; DB is the source of truth |
| **No sleep-until-due** | Scheduler cron scans indexed `(status, due_at)` every minute; restarts are safe |
| **FOR UPDATE SKIP LOCKED** | Allows multiple scheduler/outbox replicas without double-processing |
| **Idempotency key** | `user_id:provider_message_id` prevents duplicate tasks from webhook retries |

## Tech stack

- **Language**: TypeScript (Node 20+)
- **Framework**: Fastify 5
- **Database**: PostgreSQL 16 (Prisma ORM)
- **Queue**: Redis 7 + BullMQ
- **LLM**: Claude API (structured JSON output)
- **Email**: AWS SES
- **WhatsApp**: Meta WhatsApp Cloud API
- **Deploy**: Docker + docker-compose; Kubernetes manifests in `k8s/`

## Project structure

```
├── prisma/
│   ├── schema.prisma          # Data model
│   └── seed.ts                # Test user seeding
├── src/
│   ├── shared/                # Config, logger, queue, types, PII redaction
│   ├── ingress/               # Fastify server + webhook routes + validators
│   ├── workers/
│   │   ├── ingest.worker.ts     # Claude extraction
│   │   ├── scheduler.worker.ts  # Cron – finds due tasks
│   │   ├── executor.worker.ts   # Claude drafting
│   │   └── outbox.worker.ts     # Reliable send with retry
│   ├── services/              # Claude, email-sender, whatsapp-sender, task-events
│   └── admin/                 # Internal admin endpoints
├── tests/                     # Unit tests (vitest)
├── docker/                    # Dockerfile + docker-compose.yml
├── k8s/                       # Kubernetes manifests
├── .env.example
└── README.md
```

## How to run locally

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- An Anthropic API key

### 1. Start infrastructure

```bash
# Start Postgres + Redis
cd docker
docker compose up -d postgres redis
cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY and other credentials
```

### 3. Install dependencies & migrate

```bash
npm install
npx prisma migrate dev --name init
npx prisma generate
npm run db:seed
```

### 4. Start services (each in a separate terminal)

```bash
npm run dev:ingress     # Webhook server on :3000
npm run dev:ingest      # Ingest worker
npm run dev:scheduler   # Scheduler (every minute)
npm run dev:executor    # Executor worker
npm run dev:outbox      # Outbox sender
npm run dev:admin       # Admin API on :3001
```

### Docker-only (all services)

```bash
cp .env.example .env
# Edit .env
cd docker
docker compose up --build
```

## How to test end-to-end

### Sample: Email webhook

```bash
curl -X POST http://localhost:3000/webhook/email \
  -H 'Content-Type: application/json' \
  -d '{
    "messageId": "msg-001",
    "from": "alice@example.com",
    "to": "concierge@example.com",
    "subject": "Follow up",
    "textBody": "Follow up with Dr office next Friday morning about test results.",
    "timestamp": "2025-01-15T10:00:00Z"
  }'
```

Expected response:
```json
{"status":"accepted","inboundId":"<uuid>"}
```

### Sample: WhatsApp webhook

```bash
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H 'Content-Type: application/json' \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "BIZ_ID",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {"phone_number_id": "1234"},
          "messages": [{
            "id": "wamid.abc123",
            "from": "15551234567",
            "timestamp": "1705312000",
            "type": "text",
            "text": {"body": "Follow up next Friday morning about dentist"}
          }]
        }
      }]
    }]
  }'
```

### Sample: Ambiguous message (triggers clarification)

```bash
curl -X POST http://localhost:3000/webhook/email \
  -H 'Content-Type: application/json' \
  -d '{
    "messageId": "msg-ambiguous-001",
    "from": "alice@example.com",
    "to": "concierge@example.com",
    "subject": "Follow up",
    "textBody": "Follow up sometime next week",
    "timestamp": "2025-01-15T10:00:00Z"
  }'
```

### Verify idempotency (send the same payload twice)

```bash
# Send the exact same curl again — should get {"status":"duplicate"}
curl -X POST http://localhost:3000/webhook/email \
  -H 'Content-Type: application/json' \
  -d '{
    "messageId": "msg-001",
    "from": "alice@example.com",
    "to": "concierge@example.com",
    "subject": "Follow up",
    "textBody": "Follow up with Dr office next Friday morning about test results.",
    "timestamp": "2025-01-15T10:00:00Z"
  }'
```

### Admin endpoints

```bash
# List failed tasks
curl http://localhost:3001/admin/tasks/failed

# List failed outbox messages
curl http://localhost:3001/admin/outbox/failed

# Retry a failed task
curl -X POST http://localhost:3001/admin/tasks/<task-id>/retry

# Retry a failed outbox message
curl -X POST http://localhost:3001/admin/outbox/<outbox-id>/retry

# View audit trail for a task
curl http://localhost:3001/admin/tasks/<task-id>/events

# Run data retention redaction
curl -X POST http://localhost:3001/admin/retention/redact
```

## Failure testing

### Simulate provider down

1. Set invalid credentials in `.env` (e.g., `AWS_ACCESS_KEY_ID=invalid`)
2. Send a webhook to create a task with `due_at` in the past
3. Watch the outbox worker retry with exponential backoff:
   - Attempt 1: retry after 30s
   - Attempt 2: retry after 60s
   - Attempt 3: retry after 120s
   - Attempt 4: retry after 240s
   - Attempt 5: marked as `failed`
4. Check failed messages: `curl http://localhost:3001/admin/outbox/failed`
5. Fix credentials, then retry: `curl -X POST http://localhost:3001/admin/outbox/<id>/retry`

### Simulate scheduler restart

1. Create a task with `due_at` 2 minutes from now
2. Kill the scheduler worker
3. Wait past the due time
4. Restart the scheduler
5. The task will be picked up on the next tick (within 1 minute)

## Running tests

```bash
npm test
```

Tests cover:
- **Idempotency**: duplicate webhooks do not create duplicate messages/tasks
- **Scheduler**: correct selection of due tasks, ignoring future/non-pending tasks
- **Outbox**: exponential backoff, max attempts, retry-after-failure semantics

## Data model

| Table | Purpose |
|-------|---------|
| `users` | User identity (email, phone, display name) |
| `preferences` | Per-user settings (timezone, tone, default action) |
| `inbound_messages` | Every received webhook, with unique `idempotency_key` |
| `tasks` | Follow-up tasks with status machine: `pending -> due -> executing -> sending -> done` |
| `outbox` | Reliable message delivery with retry/backoff |
| `task_events` | Audit trail for every state transition |

## Definition of Done checklist

- [x] Ingress service validates webhook signatures (pluggable per provider)
- [x] Users resolved by email/phone from users table
- [x] Idempotency key (user_id + provider_message_id) prevents duplicate tasks
- [x] BullMQ job ID deduplication as second layer of idempotency
- [x] Ingest worker calls Claude for structured extraction
- [x] Ambiguous dates trigger clarification question via outbox
- [x] Clear dates create pending task with confirmation via outbox
- [x] Scheduler runs every minute, uses FOR UPDATE SKIP LOCKED
- [x] Executor generates drafts via Claude for remind_and_draft tasks
- [x] Outbox pattern with exponential backoff (30s base, 5 max attempts)
- [x] Failed outbox messages are marked failed with audit event
- [x] Every state transition records a task_event row
- [x] PII redacted before Claude calls
- [x] Data retention: admin endpoint to redact bodies after 60 days
- [x] Admin endpoints: list failed, retry, view audit events
- [x] Docker Compose for local development (Postgres + Redis + all services)
- [x] Kubernetes manifests for production deployment
- [x] Unit tests for idempotency, scheduler, and outbox
- [x] Structured logging via pino (JSON in production, pretty in dev)
- [x] Graceful shutdown handlers on all services
- [x] No sleep-until-due: cron-based scheduler with indexed DB query
- [x] No single point of failure: stateless services, queue-based processing
- [x] Environment variable validation via Zod on startup
