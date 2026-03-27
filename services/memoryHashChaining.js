const { createHash } = require('crypto');
const { ethers } = require('ethers');
const IPFS = require('ipfs-http-client');

class MemoryHashChaining {
    constructor({ contractAddress, privateKey, ipfsUrl, providerUrl }) {
        if (!contractAddress || !privateKey || !ipfsUrl || !providerUrl) {
            throw new Error('Missing required configuration parameters');
        }
        this.contractAddress = contractAddress;
        this.privateKey = privateKey;
        this.ipfsUrl = ipfsUrl;
        this.providerUrl = providerUrl;
        this.provider = new ethers.JsonRpcProvider(providerUrl);
        this.wallet = new ethers.Wallet(privateKey, this.provider);
        this.ipfs = IPFS.create({ url: ipfsUrl });
        this.memoryIndex = new Map();
        this.chainProofCache = new Map();
        this.sessionState = new Map();
    }

    async initializeSession(sessionId) {
        const genesisHash = createHash('sha256').update(`genesis:${sessionId}`).digest('hex');
        this.sessionState.set(sessionId, { genesisHash, currentHash: genesisHash, entryCount: 0 });
        return genesisHash;
    }

    async computeMemoryHash(memoryEntry, previousHash) {
        const canonicalData = JSON.stringify({
            memory: memoryEntry,
            previousHash,
            timestamp: Date.now()
        });
        return createHash('sha256').update(canonicalData).digest('hex');
    }

    async storeMemory(sessionId, memoryEntry) {
        const session = this.sessionState.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not initialized`);
        }
        const currentHash = await this.computeMemoryHash(memoryEntry, session.currentHash);
        const memoryHash = await this.ipfsMemoryHash(memoryEntry);
        const proof = this.generateChainProof(sessionId, currentHash);
        const signature = await this.signProof(proof);
        const tx = await this.submitToContract(sessionId, currentHash, memoryHash, proof, signature);
        session.currentHash = currentHash;
        session.entryCount++;
        this.memoryIndex.set(currentHash, { sessionId, entryCount: session.entryCount, timestamp: Date.now() });
        this.chainProofCache.set(currentHash, proof);
        return { hash: currentHash, txHash: tx.hash, memoryHash };
    }

    async ipfsMemoryHash(memoryEntry) {
        const canonicalData = JSON.stringify(memoryEntry);
        const content = Buffer.from(canonicalData);
        const result = await this.ipfs.add(content, { pin: true });
        return result.path;
    }

    generateChainProof(sessionId, targetHash) {
        const session = this.sessionState.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        const proof = [];
        let currentHash = session.genesisHash;
        const visited = new Set();
        while (currentHash !== targetHash && visited.size < 1000) {
            visited.add(currentHash);
            const index = this.memoryIndex.get(currentHash);
            if (!index) break;
            proof.push({
                hash: currentHash,
                entryCount: index.entryCount,
                timestamp: index.timestamp
            });
            currentHash = this.chainProofCache.get(currentHash)?.previousHash || currentHash;
        }
        return { sessionId, targetHash, proof, genesisHash: session.genesisHash };
    }

    async signProof(proof) {
        const message = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(proof))));
        const signature = await this.wallet.signMessage(message);
        return signature;
    }

    async submitToContract(sessionId, memoryHash, memoryContentHash, proof, signature) {
        const contract = new ethers.Contract(this.contractAddress, [
            'function storeMemory(uint256 sessionId, bytes32 memoryHash, string memory contentHash, bytes memory proof, bytes memory signature) external'
        ], this.wallet);
        return await contract.storeMemory(sessionId, memoryHash, memoryContentHash, ethers.defaultAbiCoder.encode(['bytes[]', 'bytes'], [proof.map(p => p.hash), signature]));
    }

    async verifyChainProof(sessionId, targetHash) {
        const session = this.sessionState.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        if (targetHash === session.genesisHash) {
            return { valid: true, reason: 'Genesis hash verified' };
        }
        const proof = this.chainProofCache.get(targetHash);
        if (!proof) {
            throw new Error('Proof not found in cache');
        }
        let currentHash = session.genesisHash;
        for (const step of proof.proof) {
            const nextHash = this.computeNextHash(step.hash, step.entryCount);
            if (nextHash !== step.hash) {
                return { valid: false, reason: 'Chain integrity broken' };
            }
            currentHash = step.hash;
        }
        return { valid: currentHash === targetHash, reason: currentHash === targetHash ? 'Chain verified' : 'Hash mismatch' };
    }

    computeNextHash(currentHash, entryCount) {
        return createHash('sha256').update(`${currentHash}:${entryCount}`).digest('hex');
    }

    async getMemoryEntry(sessionId, targetHash) {
        const index = this.memoryIndex.get(targetHash);
        if (!index) {
            throw new Error('Memory entry not found');
        }
        return { hash: targetHash, sessionId, entryCount: index.entryCount, timestamp: index.timestamp };
    }

    async pruneOldEntries(sessionId, keepCount) {
        const session = this.sessionState.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        const entries = Array.from(this.memoryIndex.entries()).filter(([_, data]) => data.sessionId === sessionId);
        entries.sort((a, b) => b[1].entryCount - a[1].entryCount);
        for (let i = keepCount; i < entries.length; i++) {
            const [hash] = entries[i];
            this.memoryIndex.delete(hash);
            this.chainProofCache.delete(hash);
        }
        session.entryCount = keepCount;
        return { pruned: entries.length - keepCount, remaining: keepCount };
    }

    async getChainState(sessionId) {
        const session = this.sessionState.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        return {
            sessionId,
            genesisHash: session.genesisHash,
            currentHash: session.currentHash,
            entryCount: session.entryCount,
            chainLength: this.memoryIndex.size
        };
    }
}

module.exports = MemoryHashChaining;
