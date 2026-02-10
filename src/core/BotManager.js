// src/core/BotManager.js
// Manages dynamic creation, updating, and removal of bot instances per client

export class BotManager {
  constructor() {
    this.bots = new Map(); // clientId -> { bot, config, status }
  }

  async addBot(clientId, config, BotEngine, createAdapter) {
    await this.removeBot(clientId);
    const bot = new BotEngine(createAdapter(config), { ...config });
    this.bots.set(clientId, { bot, config, status: 'stopped' });
    await bot.start();
    this.bots.get(clientId).status = 'running';
    return bot;
  }

  async updateBot(clientId, newConfig, BotEngine, createAdapter) {
    await this.removeBot(clientId);
    return this.addBot(clientId, newConfig, BotEngine, createAdapter);
  }

  async removeBot(clientId) {
    const entry = this.bots.get(clientId);
    if (entry) {
      await entry.bot.stop?.();
      this.bots.delete(clientId);
    }
  }

  getBot(clientId) {
    return this.bots.get(clientId)?.bot;
  }

  listBots() {
    return Array.from(this.bots.keys());
  }

  getStatus(clientId) {
    const entry = this.bots.get(clientId);
    return entry ? entry.status : 'not found';
  }
}
