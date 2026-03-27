const { MemoryStore } = require('autogen');
const { MemoryHashChaining } = require('../services/memoryHashChaining');
const { IPFSMemoryService } = require('../services/ipfsMemoryService');

class StateSyncMemoryStore extends MemoryStore {
  constructor(config = {}) {
    super();
    this.memoryHashChaining = new MemoryHashChaining(config);
    this.ipfsService = new IPFSMemoryService(config);
    this.sessionState = new Map();
    this.maxHistoryLength = config.maxHistoryLength || 1000;
  }

  async initialize() {
    await this.memoryHashChaining.initialize();
    await this.ipfsService.initialize();
  }

  async createSession(sessionId) {
    const session = {
      id: sessionId,
      createdAt: Date.now(),
      memoryChain: [],
      lastHash: null,
      entryCount: 0
    };
    this.sessionState.set(sessionId, session);
    return session;
  }

  async addMessage(sessionId, message, metadata = {}) {
    const session = this.sessionState.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const messageHash = this._hashMessage(message);
    const previousHash = session.lastHash || '0x0000000000000000000000000000000000000000000000000000000000000000';
    
    const memoryEntry = {
      messageId: messageHash,
      previousHash,
      contentHash: await this.ipfsService.pinMessage(message),
      timestamp: Date.now(),
      metadata: {
        role: message.role || 'user',
        sessionId,
        ...metadata
      }
    };

    session.memoryChain.push(memoryEntry);
    session.lastHash = memoryEntry.messageId;
    session.entryCount++;

    if (session.entryCount > this.maxHistoryLength) {
      await this._pruneOldEntries(session);
    }

    const chainProof = await this.memoryHashChaining.registerMemoryEntry(
      sessionId,
      memoryEntry.messageId,
      memoryEntry.contentHash,
      memoryEntry.timestamp
    );

    return {
      messageId: memoryEntry.messageId,
      chainProof,
      ipfsHash: memoryEntry.contentHash
    };
  }

  async getMessages(sessionId, limit = 50, offset = 0) {
    const session = this.sessionState.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const startIndex = Math.max(0, session.memoryChain.length - offset - limit);
    const endIndex = session.memoryChain.length - offset;
    const messages = session.memoryChain.slice(startIndex, endIndex).reverse();

    const enrichedMessages = await Promise.all(
      messages.map(async (entry) => {
        try {
          const content = await this.ipfsService.getMessageContent(entry.contentHash);
          return {
            ...entry,
            content,
            chainProof: await this.memoryHashChaining.getChainProof(sessionId, entry.messageId)
          };
        } catch (error) {
          return {
            ...entry,
            content: null,
            error: 'Content retrieval failed'
          };
        }
      })
    );

    return enrichedMessages;
  }

  async verifyMemoryIntegrity(sessionId) {
    const session = this.sessionState.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const chain = session.memoryChain;
    let previousHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
    const integrityReport = {
      valid: true,
      chainLength: chain.length,
      anomalies: []
    };

    for (const entry of chain) {
      const currentHash = this._hashMessage(entry);
      if (currentHash !== entry.messageId) {
        integrityReport.valid = false;
        integrityReport.anomalies.push({
          type: 'hash_mismatch',
          position: chain.indexOf(entry),
          expected: entry.messageId,
          computed: currentHash
        });
      }

      if (entry.previousHash !== previousHash) {
        integrityReport.valid = false;
        integrityReport.anomalies.push({
          type: 'chain_break',
          position: chain.indexOf(entry),
          expected: previousHash,
          actual: entry.previousHash
        });
      }

      previousHash = entry.messageId;
    }

    return integrityReport;
  }

  async deleteSession(sessionId) {
    this.sessionState.delete(sessionId);
    return true;
  }

  async getSessionStats(sessionId) {
    const session = this.sessionState.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return {
      sessionId,
      entryCount: session.entryCount,
      chainLength: session.memoryChain.length,
      createdAt: session.createdAt,
      lastHash: session.lastHash
    };
  }

  async _hashMessage(message) {
    const messageString = JSON.stringify(message);
    const encoder = new TextEncoder();
    const data = encoder.encode(messageString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `0x${hashHex}`;
  }

  async _pruneOldEntries(session) {
    const entriesToKeep = this.maxHistoryLength;
    const entriesToRemove = session.memoryChain.length - entriesToKeep;
    
    if (entriesToRemove > 0) {
      session.memoryChain = session.memoryChain.slice(-entriesToKeep);
      session.entryCount = session.memoryChain.length;
    }
  }

  async getChainProof(sessionId, messageId) {
    const session = this.sessionState.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const entryIndex = session.memoryChain.findIndex(e => e.messageId === messageId);
    if (entryIndex === -1) {
      throw new Error(`Message ${messageId} not found in session`);
    }

    const proof = [];
    for (let i = 0; i <= entryIndex; i++) {
      const entry = session.memoryChain[i];
      proof.push({
        messageId: entry.messageId,
        previousHash: entry.previousHash,
        contentHash: entry.contentHash,
        timestamp: entry.timestamp
      });
    }

    return proof;
  }

  async verifyChainProof(sessionId, proof) {
    const session = this.sessionState.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    let previousHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
    
    for (const proofEntry of proof) {
      const computedHash = this._hashMessage(proofEntry);
      if (computedHash !== proofEntry.messageId) {
        return { valid: false, reason: 'Hash mismatch' };
      }

      if (proofEntry.previousHash !== previousHash) {
        return { valid: false, reason: 'Chain break detected' };
      }

      previousHash = proofEntry.messageId;
    }

    return { valid: true, reason: 'Chain verified' };
  }
}

module.exports = { StateSyncMemoryStore };
