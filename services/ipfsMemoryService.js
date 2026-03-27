const { create } = require('ipfs-http-client');

class IPFSMemoryService {
  constructor() {
    this.ipfs = create({ url: process.env.IPFS_URL || 'http://localhost:5001' });
    this.pinCache = new Map();
  }

  async #canonicalize(obj) {
    return JSON.stringify(obj, Object.keys(obj).sort());
  }

  async #hashPayload(payload) {
    const canonical = await this.#canonicalize(payload);
    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async storeMemory(payload, metadata = {}) {
    const memoryId = crypto.randomUUID();
    const memoryData = {
      id: memoryId,
      timestamp: Date.now(),
      payload,
      metadata
    };

    const ipfsHash = await this.#hashPayload(memoryData);
    const { cid } = await this.ipfs.add(Buffer.from(JSON.stringify(memoryData)));
    
    if (!this.pinCache.has(cid.toString())) {
      await this.ipfs.pin.add(cid);
      this.pinCache.set(cid.toString(), true);
    }

    return {
      ipfsHash,
      cid: cid.toString(),
      memoryId,
      timestamp: memoryData.timestamp
    };
  }

  async retrieveMemory(cid) {
    const stream = this.ipfs.cat(cid);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    return JSON.parse(data.toString());
  }

  async verifyIntegrity(cid, expectedHash) {
    const memory = await this.retrieveMemory(cid);
    const computedHash = await this.#hashPayload(memory);
    return computedHash === expectedHash;
  }

  async getMemoryChain(cid) {
    const memory = await this.retrieveMemory(cid);
    const chain = [memory];
    let currentCid = cid;
    
    while (memory.metadata?.previousCid) {
      currentCid = memory.metadata.previousCid;
      const nextMemory = await this.retrieveMemory(currentCid);
      chain.unshift(nextMemory);
      if (!nextMemory.metadata?.previousCid) break;
    }
    
    return chain;
  }

  async pruneOldMemories(maxAgeMs = 86400000) {
    const cutoff = Date.now() - maxAgeMs;
    const toPrune = [];
    
    for (const [cid, pinned] of this.pinCache.entries()) {
      if (pinned) {
        try {
          const memory = await this.retrieveMemory(cid);
          if (memory.timestamp < cutoff) {
            toPrune.push(cid);
          }
        } catch {
          continue;
        }
      }
    }
    
    for (const cid of toPrune) {
      await this.ipfs.pin.rm(cid);
      this.pinCache.delete(cid);
    }
    
    return toPrune.length;
  }

  async healthCheck() {
    try {
      await this.ipfs.id();
      return { status: 'healthy', ipfsConnected: true };
    } catch (error) {
      return { status: 'unhealthy', ipfsConnected: false, error: error.message };
    }
  }
}

module.exports = { IPFSMemoryService };
