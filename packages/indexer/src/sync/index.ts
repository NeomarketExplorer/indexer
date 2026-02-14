/**
 * Sync orchestrator - coordinates batch, real-time, and cleanup
 *
 * Fixes applied:
 * - #5  WS resubscribe after markets sync (via callback)
 * - #8  price_history retention cleanup job
 * - #16 BackfillManager wired into orchestrator
 */

import { sql } from 'drizzle-orm';
import { createChildLogger } from '../lib/logger';
import { getConfig } from '../lib/config';
import { BatchSyncManager } from './batch';
import { RealtimeSyncManager } from './realtime';
import { BackfillManager } from './backfill';
import { getDb } from '../db';

export class SyncOrchestrator {
  private logger = createChildLogger({ module: 'sync-orchestrator' });
  private batchSync: BatchSyncManager;
  private realtimeSync: RealtimeSyncManager;
  private backfillManager: BackfillManager;
  private isRunning = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.batchSync = new BatchSyncManager();
    this.realtimeSync = new RealtimeSyncManager();
    this.backfillManager = new BackfillManager();
  }

  /**
   * Start all sync processes
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Sync orchestrator already running');
      return;
    }

    this.logger.info('Starting sync orchestrator');
    this.isRunning = true;

    // Wire WS resubscribe callback (#5)
    this.batchSync.setOnMarketsSynced(() => this.realtimeSync.resubscribe());

    // Run initial batch sync
    await this.batchSync.runInitialSync();

    // Start periodic batch sync
    this.batchSync.startPeriodicSync();

    // Start real-time sync after batch sync has markets
    await this.realtimeSync.start();

    // Start cleanup job (#8)
    this.startCleanupJob();

    this.logger.info('Sync orchestrator started');
  }

  /**
   * Stop all sync processes
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping sync orchestrator');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.batchSync.stop();
    await this.realtimeSync.stop();

    this.isRunning = false;
    this.logger.info('Sync orchestrator stopped');
  }

  /**
   * Get sync status (used by health checks)
   */
  getStatus(): {
    isRunning: boolean;
    batch: ReturnType<BatchSyncManager['getStatus']>;
    realtime: ReturnType<RealtimeSyncManager['getStatus']>;
  } {
    return {
      isRunning: this.isRunning,
      batch: this.batchSync.getStatus(),
      realtime: this.realtimeSync.getStatus(),
    };
  }

  /**
   * Force a full resync
   */
  async resync(): Promise<void> {
    this.logger.info('Forcing full resync');
    await this.batchSync.runInitialSync();
    await this.realtimeSync.resubscribe();
  }

  /**
   * Run backfill for markets missing price history (#16)
   */
  async runBackfill(): Promise<void> {
    this.logger.info('Running backfill for missing price history');
    await this.backfillManager.backfillAllMissingHistory();
  }

  // ─── Cleanup (#8) ────────────────────────────────────────

  private startCleanupJob(): void {
    // Run every 24 hours
    this.cleanupInterval = setInterval(
      () => this.runCleanup(),
      24 * 60 * 60 * 1000
    );

    // Also run once 5 minutes after startup
    setTimeout(() => this.runCleanup(), 5 * 60 * 1000);
  }

  /**
   * Delete price_history rows older than retention period.
   * Deletes in batches to avoid long-held locks.
   */
  private async runCleanup(): Promise<void> {
    const config = getConfig();
    const db = getDb();
    const logger = createChildLogger({ module: 'cleanup' });

    // price_history cleanup
    if (config.enablePriceHistory === true) {
      const cutoff = new Date(Date.now() - config.priceHistoryRetentionDays * 24 * 60 * 60 * 1000);
      let totalDeleted = 0;

      try {
        while (true) {
          const deleted = await db.execute(sql`
            DELETE FROM price_history
            WHERE id IN (
              SELECT id FROM price_history
              WHERE timestamp < ${cutoff}
              LIMIT 5000
            )
            RETURNING id
          `);

          const count = Array.isArray(deleted) ? deleted.length : 0;
          totalDeleted += count;

          if (count < 5000) break;
          // Yield to other queries between batches
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (totalDeleted > 0) {
          logger.info({ totalDeleted, retentionDays: config.priceHistoryRetentionDays, cutoff: cutoff.toISOString() }, 'Price history cleanup completed');
        }
      } catch (error) {
        logger.error({ error }, 'Price history cleanup failed');
      }
    }

    // trades cleanup (only relevant if we are persisting trades)
    if (config.enableTradesSync === true) {
      const cutoff = new Date(Date.now() - config.tradesRetentionDays * 24 * 60 * 60 * 1000);
      let totalDeleted = 0;

      try {
        while (true) {
          const deleted = await db.execute(sql`
            DELETE FROM trades
            WHERE id IN (
              SELECT id FROM trades
              WHERE timestamp < ${cutoff}
              LIMIT 5000
            )
            RETURNING id
          `);

          const count = Array.isArray(deleted) ? deleted.length : 0;
          totalDeleted += count;

          if (count < 5000) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (totalDeleted > 0) {
          logger.info({ totalDeleted, retentionDays: config.tradesRetentionDays, cutoff: cutoff.toISOString() }, 'Trades cleanup completed');
        }
      } catch (error) {
        logger.error({ error }, 'Trades cleanup failed');
      }
    }
  }
}

// Export for convenience
export { BatchSyncManager } from './batch';
export { RealtimeSyncManager } from './realtime';
export { BackfillManager } from './backfill';
