/**
 * HookManager - Event hook system for Pipeline
 * 
 * Allows registering and emitting lifecycle hooks
 * for pipeline events (before/after stages, errors, etc)
 */
export class HookManager {
  constructor() {
    this.hooks = new Map();
  }

  /**
   * Register a hook listener
   * @param {string} hookName - Hook name (e.g., 'before:stage', 'after:pipeline')
   * @param {Function} callback - Async callback function
   */
  on(hookName, callback) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }
    this.hooks.get(hookName).push(callback);
    return this;
  }

  /**
   * Emit a hook
   * @param {string} hookName - Hook name
   * @param {Object} data - Data to pass to hook listeners
   */
  async emit(hookName, data = {}) {
    const callbacks = this.hooks.get(hookName) || [];
    for (const callback of callbacks) {
      try {
        await callback(data);
      } catch (error) {
        console.error(`Error in hook '${hookName}':`, error);
      }
    }
  }

  /**
   * Get status/stats about hooks
   */
  getStatus() {
    const status = {};
    for (const [hookName, callbacks] of this.hooks) {
      status[hookName] = callbacks.length;
    }
    return status;
  }

  /**
   * Clear all hooks
   */
  clear() {
    this.hooks.clear();
    return this;
  }
}
