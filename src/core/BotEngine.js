/**
 * BotEngine - Orchestrates adapters and pipelines
 * 
 * The main entry point for setting up and running a bot.
 * Connects message adapter to pipeline for processing.
 */
export class BotEngine {
  constructor(adapter, options = {}) {
    this.adapter = adapter;
    this.pipeline = options.pipeline;
    this.db = options.db || null;  // Optional database adapter
    this.logger = options.logger || console;
    this.config = options.config || {};
    this.isRunning = false;
  }

  /**
   * Start the bot
   */
  async start() {
    try {
      this.logger.info('BotEngine: Starting...');
      // Debug: print adapter and its adapters array if present
      // console.log('DEBUG: [BotEngine.start] this.adapter:', this.adapter);
      // if (this.adapter && Array.isArray(this.adapter.adapters)) {
      //   console.log('DEBUG: [BotEngine.start] this.adapter.adapters:', this.adapter.adapters);
      // }
      // Connect database if provided
      if (this.db) {
        await this.db.connect?.();
      }

      // Initialize adapter
      await this.adapter.initialize?.();

      // If adapter has a start() method, call it to begin polling
      if (typeof this.adapter.start === 'function') {
        await this.adapter.start();
      }



      // Setup message handler
      this.adapter.on('message', async (message) => {
        await this._handleMessage(message);
      });

      // Setup chat_join_request handler (for join requests)
      if (typeof this.adapter.on === 'function') {
        this.adapter.on('chat_join_request', async (message) => {
          await this._handleMessage(message);
        });
      }

      // Setup callback_query handler (for inline button callbacks)
      if (typeof this.adapter.on === 'function') {
        this.adapter.on('callback_query', async (message) => {
          await this._handleMessage(message);
        });
      }

      this.isRunning = true;
      this.logger.info('BotEngine: Started successfully');
    } catch (error) {
      this.logger.error({ err: error }, 'BotEngine startup failed');
      process.exit(1);
    }
  }

  /**
   * Stop the bot
   */
  async stop() {
    this.logger.info('BotEngine: Stopping...');

    await this.adapter.shutdown?.();
    if (this.db) {
      await this.db.disconnect?.();
    }
    this.isRunning = false;
    this.logger.info('BotEngine: Stopped');
  }

  /**
   * Internal: Handle incoming message
   */
  async _handleMessage(message) {
    const context = {
      bot: this.adapter,
      db: this.db,
      logger: this.logger,
      config: this.config,
      state: {}  // For middleware data sharing
    };

    // Debug: Log all messages entering the pipeline

    // If using TransportAdapter, inject source adapter
    if (this.adapter.name === 'TransportAdapter' && message.source) {
      context.sourceAdapter = this.adapter.getAdapter(message.source);
    }

    if (this.pipeline) {
      await this.pipeline.process(message, context);
    }
  }

  /**
   * Get engine status
   */
  status() {
    return {
      running: this.isRunning,
      adapter: this.adapter.name,
      pipeline: this.pipeline?.inspect?.()
    };
  }
}
