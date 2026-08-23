# Telegram private-chat pilot

The bot supports anonymous one-to-one chats only. It does not link BA Eventos accounts or save events.

## 1. Create bots in BotFather

Create separate test and production bots, and connect each to its own matching app, Trigger.dev, and database environment (one bot token per deployment). In BotFather:

- disable group joins (`/setjoingroups` → Disable);
- keep inline mode disabled;
- set these commands in English and Spanish descriptions:
  - `start` — start and review consent;
  - `help` — help and available commands;
  - `new` — clear conversation history;
  - `privacy` — privacy details;
  - `delete` — permanently delete Telegram conversation data.

Never reuse the production token in local testing.

## 2. Configure secrets

Generate two independent 32-byte secrets (run this twice):

```bash
openssl rand -hex 32
```

App/deployment environment:

- `TELEGRAM_WEBHOOK_SECRET`: one generated secret Telegram sends in the webhook header;
- `TELEGRAM_ID_HASH_SECRET`: the other generated secret, at least 32 bytes, used for HMAC only at the authenticated webhook boundary;
- `TRIGGER_SECRET_KEY`: Trigger.dev key used by the app to enqueue work;
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

Trigger.dev environment (all are required for this task unless the corresponding AI provider is disabled in the existing app configuration):

- `TELEGRAM_BOT_TOKEN`;
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`;
- `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `AI_MODEL`, and `AI_BASE_URL`.

Local setup script environment:

- `TELEGRAM_BOT_TOKEN`;
- `TELEGRAM_WEBHOOK_SECRET`;
- `TELEGRAM_WEBHOOK_URL` (for example `https://baeventos.com/api/telegram`).

Raw Telegram IDs, message text, and the stable identity HMAC never enter Trigger's retained payload or queue metadata. Trigger receives only the update ID, an opaque sealed envelope, and the random conversation UUID used as its queue key. The webhook encrypts the bounded transient handoff with a random per-update AES-256-GCM key stored only in the service-role-only `telegram_updates` row. Consent is required before retaining a query as conversation history or sending it to AI. Completion clears the key, making the retained Trigger envelope undecryptable. Failed/pending deliveries retain the key for idempotent retry; retention deletes stale rows after 30 days. `/delete` or consent decline immediately deletes the conversation and HMAC identity, clears keys and identity links from all earlier delivery claims, and leaves only minimal nonidentifying delivery state until retention expires.

## 3. Deployment order

1. Apply `supabase/migrations/20260823130000_add_external_channel_conversations.sql`.
2. Configure app and Trigger.dev environment variables.
3. Deploy Trigger jobs, including `telegram-update` and `telegram-retention`.
4. Deploy the web app.
5. Configure the webhook only after both deployments are healthy:

```bash
bun scripts/telegram-webhook.ts set
bun scripts/telegram-webhook.ts info
```

These commands call Telegram only when run explicitly. They do not print the bot token or webhook secret.

## Rollback

Stop new deliveries first:

```bash
bun scripts/telegram-webhook.ts delete
```

By default this preserves pending Telegram updates. Set `TELEGRAM_DROP_PENDING_UPDATES=true` only when intentionally discarding Telegram's queue. Then roll back the app/Trigger deployments. Keep the migration until retained rows have expired or been deliberately purged.

## Manual QA

Use the test bot in a private chat:

1. Send unsupported media and verify there is no response and webhook info shows no error.
2. Send `/start`; verify bilingual disclosure and Accept/Decline buttons.
3. Send ordinary text before consent; verify no AI answer and a consent prompt.
4. Decline; verify deletion confirmation. Start again, accept, then resend the question.
5. Verify one compact event answer, links, follow-up context, and typing indicator.
6. Verify `/help`, `/privacy`, `/new`, and `/delete` in English and Spanish.
7. After `/new`, verify history is cleared but consent remains. After `/delete`, verify consent is required again.
8. Retry the same update in a controlled non-production test and verify one Trigger run/one stored turn.
9. Check database rows contain only the HMAC identity, delivery state, and ephemeral key while pending—never raw Telegram IDs, names, usernames, or payloads.
10. Confirm a normally completed `telegram_updates` row has `envelope_key = NULL` and that Trigger's retained payload/queue metadata contains no identity HMAC.
11. After `/delete` or decline, confirm every claim for that identity has `identity_hash = NULL`, `envelope_key = NULL`, and `error_code = 'identity_redacted'`.
12. Confirm group messages are ignored and rate limiting still leaves commands and consent callbacks available.

Do not run migration, deployment, webhook, or bot calls from automated tests.
