/**
 * ErrorHandler - Centralized error handling for pipeline and stages
 * 
 * Provides consistent error handling, recovery strategies, and logging
 * without cluttering stage code.
 */

export class ErrorHandler {
  constructor(logger) {
    this.logger = logger;
    this.errorHandlers = {};
    this.recoveryStrategies = {};
    this.errorStats = {
      total: 0,
      byType: {},
      byStage: {}
    };

    // Default error handlers
    this.registerErrorHandler('StageError', this.handleStageError.bind(this));
    this.registerErrorHandler('DatabaseError', this.handleDatabaseError.bind(this));
    this.registerErrorHandler('ValidationError', this.handleValidationError.bind(this));
  }

  /**
   * Handle error from a stage
   * @param {Error} error - Error instance
   * @param {string} stageName - Name of stage that errored
   * @param {Object} context - { message, config, attempt }
   * @returns {Promise<Object>} Recovery action or throw
   */
  async handle(error, stageName, context = {}) {
    this.updateStats(error, stageName);

    // Recovery strategy takes precedence over error-type dispatch.
    // If a stage has a registered strategy, use it for any error thrown by that stage.
    const strategy = this.recoveryStrategies[stageName];
    if (strategy) {
      return this.handleStageError(error, stageName, context);
    }

    // Fall back to error-type-specific handler (DatabaseError, ValidationError, etc.)
    const errorType = error.constructor.name;
    const handler = this.errorHandlers[errorType] || this.handleUnknownError.bind(this);

    try {
      return await handler(error, stageName, context);
    } catch (handlerError) {
      this.logger?.error(`Error handler for ${errorType} failed:`, handlerError);
      throw handlerError;
    }
  }

  /**
   * Register custom error handler
   * @param {string} errorType - Error class name (e.g., 'DatabaseError')
   * @param {Function} handler - Handler function
   */
  registerErrorHandler(errorType, handler) {
    this.errorHandlers[errorType] = handler;
    this.logger?.debug(`Error handler registered: ${errorType}`);
  }

  /**
   * Register recovery strategy for stage
   * @param {string} stageName - Stage name
   * @param {string} strategy - 'stop' | 'skip' | 'retry' | 'fallback'
   * @param {Object} options - { maxRetries: 3, backoffMs: 100 }
   */
  registerRecoveryStrategy(stageName, strategy, options = {}) {
    this.recoveryStrategies[stageName] = { strategy, ...options };
  }

  /**
   * Handle generic stage errors
   * @private
   */
  async handleStageError(error, stageName, context) {
    const strategy = this.recoveryStrategies[stageName];

    if (!strategy) {
      this.logger?.warn(`No recovery strategy for stage: ${stageName}`);
      return { action: 'stop', reason: 'no_strategy' };
    }

    switch (strategy.strategy) {
      case 'stop':
        this.logger?.info(`Stage error in ${stageName}, stopping pipeline`);
        return { action: 'stop', reason: 'stage_error' };

      case 'skip':
        this.logger?.warn(`Stage error in ${stageName}, skipping stage`);
        return { action: 'skip', reason: 'stage_error' };

      case 'retry':
        const attempt = context.attempt || 1;
        if (attempt < (strategy.maxRetries || 3)) {
          const backoff = strategy.backoffMs || 100;
          this.logger?.info(
            `Stage error in ${stageName}, retrying (${attempt}/${strategy.maxRetries})`
          );
          await new Promise(r => setTimeout(r, backoff * attempt));
          return { action: 'retry', reason: 'stage_error' };
        } else {
          this.logger?.error(`Stage error in ${stageName}, max retries exceeded`);
          return { action: 'stop', reason: 'max_retries' };
        }

      case 'fallback':
        this.logger?.warn(`Stage error in ${stageName}, using fallback`);
        return { action: 'fallback', reason: 'stage_error', fallbackValue: null };

      default:
        return { action: 'stop', reason: 'unknown_strategy' };
    }
  }

  /**
   * Handle database errors
   * @private
   */
  async handleDatabaseError(error, stageName, context) {
    this.logger?.error(`Database error in ${stageName}:`, error.message);

    if (error.code === 'ECONNREFUSED') {
      // Connection refused - critical, stop
      return { action: 'stop', reason: 'db_connection_failed' };
    }

    if (error.code === 'QUERY_CANCELLED') {
      // Query timeout - safe to skip
      return { action: 'skip', reason: 'db_timeout' };
    }

    // Default to skip on other DB errors (safe fallback)
    return { action: 'skip', reason: 'db_error' };
  }

  /**
   * Handle validation errors
   * @private
   */
  async handleValidationError(error, stageName, context) {
    this.logger?.warn(`Validation error in ${stageName}: ${error.message}`);
    return { action: 'skip', reason: 'validation_failed' };
  }

  /**
   * Handle unknown error types
   * @private
   */
  async handleUnknownError(error, stageName, context) {
    this.logger?.error(
      `Unhandled error in ${stageName}:`,
      error.message
    );
    return { action: 'stop', reason: 'unknown_error' };
  }

  /**
   * Update error statistics
   * @private
   */
  updateStats(error, stageName) {
    this.errorStats.total++;

    const errorType = error.constructor.name;
    this.errorStats.byType[errorType] = (this.errorStats.byType[errorType] || 0) + 1;
    this.errorStats.byStage[stageName] = (this.errorStats.byStage[stageName] || 0) + 1;
  }

  /**
   * Get error statistics
   * @returns {Object} Error stats
   */
  getStats() {
    return { ...this.errorStats };
  }

  /**
   * Reset error statistics
   */
  resetStats() {
    this.errorStats = { total: 0, byType: {}, byStage: {} };
  }
}
