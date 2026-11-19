#!/usr/bin/env bash
# Database segment of the delivery gate. Use Node/Vitest with local Miniflare, never a remote binding.
set -euo pipefail
cd "$(dirname "$0")/.."
bunx --no-install vitest run \
  src/shared/lib/db/d1-schema.test.ts \
  src/shared/lib/db/search-d1.server.test.ts \
  src/features/auth/api/better-auth-d1.server.test.ts \
  src/features/chat/api/chat-d1.server.test.ts \
  src/features/import/core/catalog-store-d1.test.ts \
  src/features/import/intake/store-d1.test.ts \
  src/jobs-worker/catalog-maintenance.test.ts
