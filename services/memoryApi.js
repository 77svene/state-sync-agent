const http = require('http');
const { URL } = require('url');
const { MemoryHashChaining } = require('./memoryHashChaining');
const { IPFSMemoryService } = require('./ipfsMemoryService');

const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 100;

const rateLimitStore = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return true;
  }
  
  const record = rateLimitStore.get(ip);
  if (record.windowStart < windowStart) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return true;
  }
  
  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  
  record.count++;
  return true;
}

class MemoryAPI {
  constructor(config) {
    this.contractAddress = config.contractAddress;
    this.privateKey = config.privateKey;
    this.ipfsService = new IPFSMemoryService(config.ipfsUrl);
    this.chaining = new MemoryHashChaining(config);
    this.server = null;
  }

  async registerMemory(sessionId, memoryData, agentId) {
    const previousHash = await this.chaining.getPreviousHash(sessionId);
    const currentHash = await this.chaining.computeHash(memoryData, previousHash);
    
    const ipfsCid = await this.ipfsService.storeMemory({
      sessionId,
      memoryData,
      timestamp: Date.now(),
      agentId
    });

    const txHash = await this.chaining.registerMemoryHash(
      sessionId,
      currentHash,
      ipfsCid,
      agentId
    );

    return { sessionId, hash: currentHash, ipfsCid, txHash };
  }

  async getMemoryHistory(sessionId) {
    const entries = await this.chaining.getChainProof(sessionId);
    const fullHistory = [];
    
    for (const entry of entries) {
      const memoryData = await this.ipfsService.retrieveMemory(entry.ipfsCid);
      fullHistory.push({
        ...entry,
        memoryData,
        verified: await this.chaining.verifyChainIntegrity(entry)
      });
    }
    
    return fullHistory;
  }

  async verifyMemoryChain(sessionId) {
    const entries = await this.chaining.getChainProof(sessionId);
    let isValid = true;
    let lastHash = null;
    const verificationResults = [];

    for (const entry of entries) {
      const computedHash = await this.chaining.computeHash(
        entry.memoryData,
        lastHash
      );
      const isMatch = computedHash === entry.hash;
      
      verificationResults.push({
        index: entry.index,
        hash: entry.hash,
        computedHash,
        isMatch,
        ipfsCid: entry.ipfsCid
      });
      
      if (!isMatch) isValid = false;
      lastHash = entry.hash;
    }

    return { sessionId, isValid, verificationResults };
  }

  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;
    const path = url.pathname;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!checkRateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return;
    }

    try {
      if (method === 'POST' && path === '/memory/register') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          const { sessionId, memoryData, agentId } = JSON.parse(body);
          const result = await this.registerMemory(sessionId, memoryData, agentId);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        });
        return;
      }

      if (method === 'GET' && path.startsWith('/memory/history/')) {
        const sessionId = path.split('/').pop();
        const history = await this.getMemoryHistory(sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId, history }));
        return;
      }

      if (method === 'GET' && path.startsWith('/memory/verify/')) {
        const sessionId = path.split('/').pop();
        const verification = await this.verifyMemoryChain(sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(verification));
        return;
      }

      if (method === 'GET' && path === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', timestamp: Date.now() }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  start(port) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(port, () => {
      console.log(`Memory API running on port ${port}`);
    });
    return this.server;
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = { MemoryAPI };
