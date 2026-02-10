/**
 * ActionHandler - Process and dispatch actions from middleware
 * 
 * Middleware returns actions instead of side effects.
 * ActionHandler centralizes communication and notifications.
 * 
 * @example
 * // In middleware
 * return {
 *   action: 'notify_admin',
 *   data: { userId: 123, reason: 'spam' }
 * };
 * 
 * // ActionHandler processes it
 * actionHandler.register('notify_admin', async (data, context) => {
 *   await context.bot.sendMessage(ADMIN_CHAT_ID, `Alert: ${data.reason}`);
 * });
 */

export class ActionHandler {
  constructor(logger) {
    this.logger = logger;
    this.handlers = {};
    this.stats = {
      total: 0,
      byAction: {},
      failed: 0
    };
  }

  /**
   * Register handler for an action type
   * @param {string} actionType - Action name (e.g., 'notify_admin')
   * @param {Function} handler - async (data, context) => void
   */
  register(actionType, handler) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler for action "${actionType}" must be a function`);
    }

    this.handlers[actionType] = handler;
    this.logger?.debug(`Action handler registered: ${actionType}`);
  }

  /**
   * Process an action
   * @param {string} actionType - Action type
   * @param {Object} data - Action data
   * @param {Object} context - Bot context
   * @returns {Promise<boolean>} True if handled, false if no handler
   */
  async handle(actionType, data = {}, context) {
    if (!actionType) {
      return false;
    }

    const handler = this.handlers[actionType];
    if (!handler) {
      this.logger?.warn(`No handler registered for action: ${actionType}`);
      return false;
    }

    try {
      await handler(data, context);
      this.updateStats(actionType);
      return true;
    } catch (error) {
      this.logger?.error(`Action handler failed for "${actionType}":`, error);
      this.stats.failed++;
      throw error; // Re-throw so caller can handle
    }
  }

  /**
   * Process multiple actions from a message
   * @param {Array} actions - Array of { action, data } objects
   * @param {Object} context - Bot context
   * @returns {Promise<void>}
   */
  async handleAll(actions = [], context) {
    if (!Array.isArray(actions)) {
      return;
    }

    for (const { action, data } of actions) {
      try {
        await this.handle(action, data, context);
      } catch (error) {
        // Log but continue processing other actions
        this.logger?.error(`Failed to handle action "${action}":`, error.message);
      }
    }
  }

  /**
   * Update statistics
   * @private
   */
  updateStats(actionType) {
    this.stats.total++;
    this.stats.byAction[actionType] = (this.stats.byAction[actionType] || 0) + 1;
  }

  /**
   * Get action handler statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Get list of registered actions
   */
  getRegistered() {
    return Object.keys(this.handlers);
  }

  /**
   * Clear all handlers
   */
  clear() {
    this.handlers = {};
    this.logger?.debug('All action handlers cleared');
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = { total: 0, byAction: {}, failed: 0 };
  }
}

/**
 * Create action from middleware result
 * @param {string} action - Action type
 * @param {Object} data - Action data
 * @returns {Object}
 */
export function createAction(action, data = {}) {
  return { action, data, timestamp: Date.now() };
}

/**
 * Helper: Create middleware that processes actions
 * @param {ActionHandler} actionHandler - ActionHandler instance
 * @returns {Function} Middleware function
 */
export function createActionProcessorMiddleware(actionHandler) {
  return async (message, context) => {
    if (!message._actions || message._actions.length === 0) {
      return;
    }

    // Process all accumulated actions
    await actionHandler.handleAll(message._actions, context);
  };
}

/**
 * Helper: Accumulate actions in message
 * Useful for middleware that wants to add actions
 * @param {Object} message - Message object
 * @param {string} action - Action type
 * @param {Object} data - Action data
 */
export function addAction(message, action, data = {}) {
  if (!message._actions) {
    message._actions = [];
  }
  message._actions.push({ action, data, timestamp: Date.now() });
}

/**
 * Helper: Get actions from message
 * @param {Object} message - Message object
 * @returns {Array}
 */
export function getActions(message) {
  return message._actions || [];
}

/**
 * Helper: Clear actions from message
 * @param {Object} message - Message object
 */
export function clearActions(message) {
  message._actions = [];
}
