/**
 * TransportAdapter - Combine multiple adapters into one
 * 
 * Allows a single BotEngine instance to handle messages from multiple sources.
 * All adapters process messages through the same pipeline.
 */
export class TransportAdapter {
  constructor(adapters = []) {
    this.adapters = adapters;
    this.name = 'TransportAdapter';
    this.handlers = {};
  }

  /**
   * Get chat info (delegates to first adapter with getChat)
   */
  async getChat(chatId) {
    const adapter = this.adapters.find(a => typeof a.getChat === 'function');
    if (!adapter) {
      throw new Error('No adapter with getChat method available');
    }
    return adapter.getChat(chatId);
  }

  /**
   * Start all adapters that support start()
   */
  async start() {
    for (const adapter of this.adapters) {
      if (typeof adapter.start === 'function') {
        await adapter.start();
      }
    }
  }

  /**
   * Initialize all adapters
   */
  async initialize() {
    try {
      await Promise.all(this.adapters.map(a => a.initialize?.()));
    } catch (error) {
      throw new Error(`TransportAdapter initialization failed: ${error.message}`);
    }
  }

  /**
   * Register event handler with all adapters
   */
  on(eventName, handler) {
    this.handlers[eventName] = handler;

    this.adapters.forEach(adapter => {
      if (!adapter || typeof adapter.on !== 'function') return;
      adapter.on(eventName, (msg) => {
        msg.source = adapter.name;

        if (eventName !== 'message' && (typeof msg.type === 'undefined' || msg.type === null)) {
          msg.type = eventName;
        }

        handler(msg);
      });
    });
  }

  /**
   * Shutdown all adapters
   */
  async shutdown() {
    try {
      await Promise.all(this.adapters.map(a => a.shutdown?.()));
      console.log('✅ All adapters shut down');
    } catch (error) {
      console.error('Shutdown error:', error);
    }
  }

  /**
   * Send message - uses first adapter by default
   */
  async sendMessage(chatId, text, options = {}) {
    if (this.adapters.length === 0) {
      throw new Error('No adapters configured');
    }
    return this.adapters[0].sendMessage(chatId, text, options);
  }

  /**
   * Send via specific adapter by name
   */
  async sendMessageVia(adapterName, chatId, text, options = {}) {
    const adapter = this.adapters.find(a => a.name === adapterName);
    if (!adapter) {
      throw new Error(`Adapter '${adapterName}' not found`);
    }
    return adapter.sendMessage(chatId, text, options);
  }

  /**
   * Send poll (delegates to first adapter with sendPoll)
   */
  async sendPoll(chatId, question, options, extra = {}) {
    const adapter = this.adapters.find(a => typeof a.sendPoll === 'function');
    if (!adapter) {
      throw new Error('No adapter with sendPoll method available');
    }
    return adapter.sendPoll(chatId, question, options, extra);
  }

  /**
   * Approve a chat join request
   */
  async approveChatJoinRequest(chatId, userId) {
    const adapter = this.adapters.find(a => typeof a.approveChatJoinRequest === 'function');
    if (!adapter) {
      throw new Error('No adapter with approveChatJoinRequest method available');
    }
    return adapter.approveChatJoinRequest(chatId, userId);
  }

  /**
   * Decline a chat join request
   */
  async declineChatJoinRequest(chatId, userId) {
    const adapter = this.adapters.find(a => typeof a.declineChatJoinRequest === 'function');
    if (!adapter) {
      throw new Error('No adapter with declineChatJoinRequest method available');
    }
    return adapter.declineChatJoinRequest(chatId, userId);
  }

  /**
   * Ban a member
   */
  async banMember(chatId, userId) {
    const adapter = this.adapters.find(a => typeof a.banMember === 'function');
    if (!adapter) {
      throw new Error('No adapter with banMember method available');
    }
    return adapter.banMember(chatId, userId);
  }

  /**
   * Unban a member
   */
  async unbanMember(chatId, userId) {
    const adapter = this.adapters.find(a => typeof a.unbanMember === 'function');
    if (!adapter) {
      throw new Error('No adapter with unbanMember method available');
    }
    return adapter.unbanMember(chatId, userId);
  }

  /**
   * Restrict a member
   */
  async restrictMember(chatId, userId, permissions) {
    const adapter = this.adapters.find(a => typeof a.restrictMember === 'function');
    if (!adapter) {
      throw new Error('No adapter with restrictMember method available');
    }
    return adapter.restrictMember(chatId, userId, permissions);
  }

  /**
   * Get adapter by name
   */
  getAdapter(name) {
    return this.adapters.find(a => a.name === name);
  }
}
