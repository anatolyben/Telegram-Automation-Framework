/**
 * TelegramAdapter - Telegram Bot API adapter
 * 
 * Wraps node-telegram-bot-api for use with BotEngine.
 */
export class TelegramAdapter {
    /**
     * Send poll
     */
    async sendPoll(chatId, question, options, extra = {}) {
      if (!this.botInstance || typeof this.botInstance.sendPoll !== 'function') {
        throw new Error('Telegram bot instance not initialized or sendPoll not available');
      }
      return this.botInstance.sendPoll(chatId, question, options, extra);
    }
    /**
     * Approve a chat join request
     */
    async approveChatJoinRequest(chatId, userId) {
      if (!this.botInstance || typeof this.botInstance.approveChatJoinRequest !== 'function') {
        throw new Error('Telegram bot instance not initialized or approveChatJoinRequest not available');
      }
      return this.botInstance.approveChatJoinRequest(chatId, userId);
    }

    /**
     * Decline a chat join request
     */
    async declineChatJoinRequest(chatId, userId) {
      if (!this.botInstance || typeof this.botInstance.declineChatJoinRequest !== 'function') {
        throw new Error('Telegram bot instance not initialized or declineChatJoinRequest not available');
      }
      return this.botInstance.declineChatJoinRequest(chatId, userId);
    }
  constructor(botToken, options = {}) {
    this.name = 'TelegramAdapter';
    this.botToken = botToken;
    this.botInstance = null;
    this.handlers = {};
  }

  /**
   * Get chat info (for framework compatibility)
   */
  async getChat(chatId) {
    if (!this.botInstance || typeof this.botInstance.getChat !== 'function') {
      throw new Error('Telegram bot instance not initialized or getChat not available');
    }
    return this.botInstance.getChat(chatId);
  }

  /**
   * Initialize Telegram Bot
   */
  async initialize() {
    if (!this.botToken) {
      throw new Error('Telegram bot token is required');
    }

    // Lazy import to avoid hard dependency on node-telegram-bot-api
    const TelegramBot = (await import('node-telegram-bot-api')).default;

    // Create bot instance with autoStart disabled to prevent early polling
    this.botInstance = new TelegramBot(this.botToken, {
      polling: { interval: 3000, autoStart: false, params: { timeout: 10 } }
    });

    // Setup callback_query listener
    this.botInstance.on('callback_query', async (query) => {
      if (this.handlers.callback_query) {
        // Normalize callback_query to pipeline format
        const normalized = {
          type: 'callback_query',
          id: query.id,
          from: query.from,
          data: query.data,
          message: query.message,
          chat: query.message?.chat,
          raw: query
        };
        await this.handlers.callback_query(normalized);
      }
    });
    // Setup polling error handler
    this.botInstance.on('polling_error', (error) => {
      if (error.code === 'ETELEGRAM') {
        if (error.response?.statusCode === 429) {
          const retryAfter = error.response?.body?.parameters?.retry_after || 482;
          console.warn(`⚠️  Rate limited (429): Retry after ${retryAfter}s`);
          // Bot will auto-retry
        } else if (error.response?.statusCode === 409) {
          console.error('❌ Telegram 409 Conflict: Another bot instance is running');
          console.error('   Kill all node processes and restart');
        } else {
          console.error(`Telegram error ${error.response?.statusCode}:`, error.message);
        }
      } else {
        console.error('Polling error:', error.message);
      }
    });

    // Setup message listener
    this.botInstance.on('message', async (msg) => {
      if (this.handlers.message) {
        await this.handlers.message(this._normalizeMessage(msg));
      }
    });

    this.botInstance.on('edited_message', async (msg) => {
      if (this.handlers.message) {
        await this.handlers.message(this._normalizeMessage(msg));
      }
    });

    // Setup chat_join_request listener
    this.botInstance.on('chat_join_request', async (request) => {
      if (this.handlers.chat_join_request) {
        // Normalize join request to pipeline message format (ensure chat.id and chat.type)
        const normalized = {
          type: 'chat_join_request',
          chat: {
            id: request.chat.id,
            title: request.chat.title || request.chat.username,
            type: request.chat.type
          },
          user: request.from,
          date: request.date,
          raw: request
        };
        await this.handlers.chat_join_request(normalized);
      }
    });
  }

  /**
   * Register event handler
   */
  on(eventName, handler) {
    this.handlers[eventName] = handler;
  }

  /**
   * Start polling (call this after initialize)
   */
  async start() {
    if (this.botInstance) {
      await this.botInstance.startPolling();
    }
  }

  /**
   * Shutdown Telegram Bot
   */
  async shutdown() {
    if (this.botInstance) {
      try {
        await this.botInstance.stopPolling();
        await this.botInstance.close();
      } catch (error) {
        console.error('Error shutting down bot:', error.message);
      }
    }
  }

  /**
   * Send message
   */
  async sendMessage(chatId, text, options = {}) {
    return this.botInstance.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...options
    });
  }

  /**
   * Delete message
   */
  async deleteMessage(chatId, messageId) {
    return this.botInstance.deleteMessage(chatId, messageId);
  }

  /**
   * Edit message
   */
  async editMessage(chatId, messageId, text, options = {}) {
    return this.botInstance.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...options
    });
  }

  /**
   * Ban member
   */
  async banMember(chatId, userId) {
    return this.botInstance.banChatMember(chatId, userId);
  }

  /**
   * Unban member
   */
  async unbanMember(chatId, userId) {
    return this.botInstance.unbanChatMember(chatId, userId);
  }

  /**
   * Restrict member (set permissions)
   */
  async restrictMember(chatId, userId, permissions) {
    return this.botInstance.restrictChatMember(chatId, userId, permissions);
  }

  /**
   * Normalize Telegram message to framework format
   */
  _normalizeMessage(msg) {
    // Detect event type
    let type = undefined;
    if (msg.new_chat_members) type = 'new_chat_members';
    else if (msg.left_chat_member) type = 'left_chat_member';
    else if (msg.new_chat_member) type = 'new_chat_member';
    else if (msg.left_chat_participant) type = 'left_chat_participant';
    else if (msg.text) type = 'text';

    return {
      id: msg.message_id,
      chatId: msg.chat.id,
      chat: {
        id: msg.chat.id,
        title: msg.chat.title || msg.chat.username,
        type: msg.chat.type
      },
      from: msg.from ? {
        id: msg.from.id,
        firstName: msg.from.first_name,
        lastName: msg.from.last_name,
        username: msg.from.username
      } : undefined,
      text: msg.text || '',
      entities: msg.entities || [],
      timestamp: new Date(msg.date * 1000),
      raw: msg, // Keep original for advanced users
      type
    };
  }
}
