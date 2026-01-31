/**
 * Sync orchestrator - coordinates batch and real-time sync
 */

import { getLogger, createChildLogger } from '../lib/logger';
import { getConfig } from '../lib/config';
import { BatchSyncManager } from './batch';
import { RealtimeSyncManager } from './realtime';
import { getDb } from '../db';

export class SyncOrchestrator {
  private logger = createChildLogger({ module: 'sync-orchestrator' });
  private batchSync: BatchSyncManager;
  private realtimeSync: RealtimeSyncManager;
  private isRunning = false;

  constructor() {
    this.batchSync = new BatchSyncManager();
    this.realtimeSync = new RealtimeSyncManager();
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

    // Run initial batch sync
    await this.batchSync.runInitialSync();

    // Start periodic batch sync
    this.batchSync.startPeriodicSync();

    // Start real-time sync after batch sync has markets
    await this.realtimeSync.start();

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

    this.batchSync.stop();
    await this.realtimeSync.stop();

    this.isRunning = false;
    this.logger.info('Sync orchestrator stopped');
  }

  /**
   * Get sync status
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
}

// Export for convenience
export { BatchSyncManager } from './batch';
export { RealtimeSyncManager } from './realtime';
export { BackfillManager } from './backfill';
