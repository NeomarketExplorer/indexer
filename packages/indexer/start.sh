#!/bin/sh
set -e

echo "Running database migrations..."
pnpm db:migrate

echo "Starting indexer..."
exec pnpm start
