import { HookManager } from './HookManager.js';
import { ErrorHandler } from './ErrorHandler.js';

/**
 * Pipeline - Sequential message processor with early termination
 * 
 * Executes stages in order, passing message and context to each.
 * A stage can return { stop: true, ...metadata } to halt the pipeline.
 * 
 * Usage:
 *   const pipeline = new Pipeline();
 *   // or backward compatible: const pipeline = createPipeline();
 */
export class Pipeline {
  constructor(stages = []) {
    this.stages = stages;
    this.logger = null;
    this.hooks = null;
    this.errorHandler = null;
  }

  /**
   * Add a stage to the pipeline
   * @param {Function} stage - async (message, context) => void | { stop: true, ...meta }
   */
  use(stage) {
    this.stages.push(stage);
    return this;
  }

  /**
   * Set hook manager for pipeline events
   * @param {HookManager} hookManager
   */
  setHooks(hookManager) {
    this.hooks = hookManager;
    return this;
  }

  /**
   * Set error handler for stage failures
   * @param {ErrorHandler} errorHandler
   */
  setErrorHandler(errorHandler) {
    this.errorHandler = errorHandler;
    return this;
  }

  /**
   * Process a message through all stages
   * @param {Object} message - Message object from adapter
   * @param {Object} context - { bot, db, cache, logger, config }
   * @returns {Object} Result object with stop flag, actions, and any metadata
   */
  async process(message, context) {
      const result = { stop: false, metadata: {}, actions: [] };

      // Debug: Log message at pipeline entry
      
      // Initialize message action tracking
      if (!message._actions) {
        message._actions = [];
      }

      // Emit before:pipeline hook
      if (this.hooks) {
        await this.hooks.emit('before:pipeline', { message });
      }

      for (const stage of this.stages) {
        const stageName = stage.name || 'anonymous';
        const maxAttempts = this.errorHandler?.recoveryStrategies[stageName]?.maxRetries ?? 3;
        let attempt = 0;
        let stageComplete = false;

        while (!stageComplete) {
          try {
            // Emit before:stage hook
            if (this.hooks) {
              await this.hooks.emit('before:stage', { message, stageName });
            }

            const stageResult = await stage(message, context);

            // Collect actions from stage result
            if (stageResult?.action) {
              const action = {
                action: stageResult.action,
                data: stageResult.data || {},
                stage: stageName,
                timestamp: Date.now()
              };
              message._actions.push(action);
              result.actions.push(action);
            }

            // Emit after:stage hook
            if (this.hooks) {
              await this.hooks.emit('after:stage', { message, stageName, result: stageResult });
            }

            if (stageResult?.stop) {
              result.stop = true;
              result.metadata = { ...result.metadata, ...stageResult };
              context.logger?.info(
                { stage: stageName, message: message.id },
                `Pipeline halted at stage: ${stageName}`
              );
            }

            stageComplete = true;

          } catch (error) {
            attempt++;
            context.logger?.error(
              { err: error, stage: stageName, messageId: message.id, attempt },
              `Pipeline stage failed: ${stageName}`
            );

            // Emit error:stage hook
            if (this.hooks) {
              await this.hooks.emit('error:stage', { message, stageName, error });
            }

            if (this.errorHandler) {
              const recovery = await this.errorHandler.handle(
                error,
                stageName,
                { message, attempt }
              );

              if (recovery.action === 'stop') {
                result.stop = true;
                result.error = error;
                result.errorStage = stageName;
                stageComplete = true;
              } else if (recovery.action === 'skip') {
                stageComplete = true; // Move to next stage
              } else if (recovery.action === 'retry') {
                if (attempt >= maxAttempts) {
                  // Max retries reached — stop
                  result.stop = true;
                  result.error = error;
                  result.errorStage = stageName;
                  stageComplete = true;
                }
                // else: loop again to retry current stage
              } else {
                stageComplete = true;
              }
            } else {
              // Default: skip to next stage
              stageComplete = true;
            }
          }
        }

        if (result.stop) break;
      }

      // Emit after:pipeline hook
      if (this.hooks) {
        await this.hooks.emit('after:pipeline', {
          message,
          result
        });
      }

      return result;
    }

    /**
     * Get pipeline info
     */
    inspect() {
      return {
        stageCount: this.stages.length,
        stages: this.stages.map(s => ({ name: s.name || 'anonymous' })),
        hasHooks: !!this.hooks,
        hookStats: this.hooks?.getStatus(),
        hasErrorHandler: !!this.errorHandler,
        errorStats: this.errorHandler?.getStats()
      };
    }
}

/**
 * createPipeline - Factory function for backward compatibility
 * Use new Pipeline() instead
 */
export function createPipeline(stages = []) {
  return new Pipeline(stages);
}
