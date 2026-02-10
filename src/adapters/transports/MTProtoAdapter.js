/**
 * MTProtoAdapter - Telegram MT Proto Protocol adapter
 * 
 * Direct MT Proto protocol implementation for Telegram.
 * Provides lower-level access to Telegram's binary protocol.
 */
export class MTProtoAdapter {
  constructor(options = {}) {
    this.name = 'MTProtoAdapter';
    this.apiId = options.apiId;
    this.apiHash = options.apiHash;
    this.sessionString = options.sessionString;
    this.phoneNumber = options.phoneNumber;
    
    this.client = null;
    this.handlers = {};
    this.isConnected = false;
  }

  /**
   * Initialize MT Proto connection
   * Requires TelegramClient from Telethon.js or similar
   */
  async initialize() {
    if (!this.apiId || !this.apiHash) {
      throw new Error('apiId and apiHash are required for MT Proto adapter');
    }

    try {
      // Lazy import to avoid hard dependency
      const { TelegramClient } = await import('telegram');
      const { StringSession } = await import('telegram/sessions');

      // Create session
      const session = this.sessionString 
        ? new StringSession(this.sessionString)
        : new StringSession('');

      // Initialize client
      this.client = new TelegramClient(session, this.apiId, this.apiHash, {
        connectionRetries: 5,
        retryDelay: 1000,
        timeout: 10000,
        requestTimeout: 10000,
      });

      // Connect to Telegram
      await this.client.connect();
      this.isConnected = true;

      // If not authenticated, authenticate with phone number
      if (!await this.client.isUserAuthorized()) {
        if (!this.phoneNumber) {
          throw new Error('Phone number required for initial authentication');
        }
        await this._authenticate();
      }

      // Setup event handlers with proper GramJS event filters
      const { NewMessage, EditedMessage } = await import('telegram/events/index.js');
      this.client.addEventHandler(this._handleNewMessage.bind(this), new NewMessage({}));
      this.client.addEventHandler(this._handleEditedMessage.bind(this), new EditedMessage({}));
      
    } catch (error) {
      this.isConnected = false;
      throw new Error(`MT Proto initialization failed: ${error.message}`);
    }
  }

  /**
   * Authenticate with phone number
   * @private
   */
  async _authenticate() {
    try {
      const phoneCodeHash = await this.client.sendCodeRequest(this.phoneNumber);
      // In production, you'd get this from user input
      const code = process.env.TELEGRAM_CODE || '';
      
      if (!code) {
        throw new Error('Authentication code required');
      }

      await this.client.signIn(this.phoneNumber, code, undefined, phoneCodeHash);
    } catch (error) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Handle new message event
   * @private
   */
  async _handleNewMessage(event) {
    const message = await this._normalizeMessage(event.message);
    if (event.isPrivate) {
      if (this.handlers.message) {
        await this.handlers.message(message);
      }
    } else if (event.isGroup || event.isChannel) {
      if (this.handlers.groupMessage) {
        await this.handlers.groupMessage(message);
      }
    }
  }

  /**
   * Handle edited message event
   * @private
   */
  async _handleEditedMessage(event) {
    const message = await this._normalizeMessage(event.message);
    if (this.handlers.editedMessage) {
      await this.handlers.editedMessage(message);
    }
  }

  /**
   * Register event handler
   */
  on(eventName, handler) {
    this.handlers[eventName] = handler;
  }

  /**
   * Shutdown MT Proto connection
   */
  async shutdown() {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  /**
   * Send message to user or chat
   */
  async sendMessage(chatId, text, options = {}) {
    if (!this.client || !this.isConnected) {
      throw new Error('MT Proto client not connected');
    }

    try {
      const entity = await this.client.getEntity(chatId);
      const result = await this.client.sendMessage(entity, {
        message: text,
        ...options
      });
      return result;
    } catch (error) {
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  /**
   * Delete message
   */
  async deleteMessage(chatId, messageId) {
    if (!this.client || !this.isConnected) {
      throw new Error('MT Proto client not connected');
    }

    try {
      const entity = await this.client.getEntity(chatId);
      await this.client.deleteMessages(entity, [messageId]);
    } catch (error) {
      throw new Error(`Failed to delete message: ${error.message}`);
    }
  }

  /**
   * Edit message
   */
  async editMessage(chatId, messageId, text, options = {}) {
    if (!this.client || !this.isConnected) {
      throw new Error('MT Proto client not connected');
    }

    try {
      const entity = await this.client.getEntity(chatId);
      const result = await this.client.editMessage(entity, messageId, {
        text: text,
        ...options
      });
      return result;
    } catch (error) {
      throw new Error(`Failed to edit message: ${error.message}`);
    }
  }

  /**
   * Get chat info
   */
  async getChatInfo(chatId) {
    if (!this.client || !this.isConnected) {
      throw new Error('MT Proto client not connected');
    }

    try {
      const entity = await this.client.getEntity(chatId);
      const dialogs = await this.client.getDialogs();
      
      return {
        id: entity.id,
        title: entity.title || entity.first_name || entity.username,
        type: entity.megagroup ? 'supergroup' : entity.group ? 'group' : 'private',
        isGroup: entity.isGroup,
        isSupergroup: entity.isSupergroup,
        username: entity.username,
        raw: entity
      };
    } catch (error) {
      throw new Error(`Failed to get chat info: ${error.message}`);
    }
  }

  /**
   * Get user info
   */
  async getUserInfo(userId) {
    if (!this.client || !this.isConnected) {
      throw new Error('MT Proto client not connected');
    }

    try {
      const user = await this.client.getEntity(userId);
      return {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        isBot: user.bot,
        isScam: user.scam,
        isFake: user.fake,
        raw: user
      };
    } catch (error) {
      throw new Error(`Failed to get user info: ${error.message}`);
    }
  }

  /**
   * Get chat members
   */
  async getChatMembers(chatId) {
    if (!this.client || !this.isConnected) {
      throw new Error('MT Proto client not connected');
    }

    try {
      const entity = await this.client.getEntity(chatId);
      const members = await this.client.getParticipants(entity);
      
      return members.map(member => ({
        id: member.id,
        firstName: member.first_name,
        lastName: member.last_name,
        username: member.username,
        isBot: member.bot,
        raw: member
      }));
    } catch (error) {
      throw new Error(`Failed to get chat members: ${error.message}`);
    }
  }

  /**
   * Ban user from chat
   */
  async banMember(chatId, userId) {
    if (!this.client || !this.isConnected) {
      throw new Error('MT Proto client not connected');
    }

    try {
      const entity = await this.client.getEntity(chatId);
      await this.client.editBanned(entity, userId, {
        view_messages: false
      });
    } catch (error) {
      throw new Error(`Failed to ban member: ${error.message}`);
    }
  }

  /**
   * Unban user from chat
   */
  async unbanMember(chatId, userId) {
    if (!this.client || !this.isConnected) {
      throw new Error('MT Proto client not connected');
    }

    try {
      const entity = await this.client.getEntity(chatId);
      await this.client.editBanned(entity, userId, null);
    } catch (error) {
      throw new Error(`Failed to unban member: ${error.message}`);
    }
  }

  /**
   * Restrict member (set permissions)
   */
  async restrictMember(chatId, userId, permissions) {
    if (!this.client || !this.isConnected) {
      throw new Error('MT Proto client not connected');
    }

    try {
      const entity = await this.client.getEntity(chatId);
      await this.client.editBanned(entity, userId, permissions);
    } catch (error) {
      throw new Error(`Failed to restrict member: ${error.message}`);
    }
  }

  /**
   * Normalize MT Proto message to framework format
   * @private
   */
  async _normalizeMessage(msg) {
    return {
      id: msg.id,
      chatId: msg.chatId,
      chat: {
        id: msg.chatId,
        title: msg.chat?.title || msg.chat?.first_name,
        type: msg.isGroup ? 'group' : 'private'
      },
      from: {
        id: msg.fromId?.userId || msg.senderId,
        firstName: msg.sender?.firstName,
        lastName: msg.sender?.lastName,
        username: msg.sender?.username
      },
      text: msg.text || '',
      entities: msg.entities || [],
      timestamp: new Date(msg.date * 1000),
      isEdit: msg.isEdit,
      raw: msg
    };
  }

  /**
   * Get session string for saving
   */
  getSessionString() {
    if (!this.client || !this.client.session) {
      return null;
    }
    return this.client.session.save();
  }
}
