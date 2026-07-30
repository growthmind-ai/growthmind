-- pgvector is enabled from the very first migration so no later migration
-- ever has to introduce the extension (docs/stack.md, Phase 1). The compose
-- image (pgvector/pgvector) ships it; on a managed Postgres, enable the
-- extension for your database if this statement is rejected.
CREATE EXTENSION IF NOT EXISTS vector;
