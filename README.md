# 🧠 StateSync: Verifiable Agent Memory Ledger

> **One-line Pitch:** The first on-chain Memory Hash Chaining primitive enabling cryptographically verifiable agent recall without exposing raw data.

**Hackathon:** [Microsoft AI Agents Hackathon](https://www.microsoft.com/en-us/ai) | **Track:** Multi-Agent Systems | **Prize Pool:** $50K+

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8+-purple.svg)](https://soliditylang.org/)
[![IPFS](https://img.shields.io/badge/IPFS-1.0-blue.svg)](https://ipfs.tech/)
[![Ethereum](https://img.shields.io/badge/Ethereum-Goerli-orange.svg)](https://ethereum.org/)

## 🚀 Problem
Autonomous AI agents operate in ephemeral environments where memory is volatile. In multi-agent systems, this leads to critical issues:
*   **Hallucination Drift:** Agents cannot prove what they previously "remembered" or reasoned about.
*   **Lack of Auditability:** Enterprise stakeholders cannot verify agent decisions or trace reasoning history.
*   **Data Privacy:** Storing raw memory on-chain exposes sensitive PII, while local storage lacks integrity guarantees.
*   **Tampering:** Agents or malicious actors can retroactively alter memory logs to cover up errors.

## 💡 Solution
**StateSync** introduces a middleware layer that replaces ephemeral memory stores with a **Verifiable Memory Ledger**. By implementing a **Memory Hash Chaining** primitive, every state change is cryptographically linked to the previous entry and anchored on-chain via IPFS and Ethereum.

*   **Tamper-Evident History:** Each memory entry contains the hash of the previous entry, creating an immutable chain of thought.
*   **Privacy-Preserving:** Only memory hashes and metadata are stored on-chain; raw data remains off-chain (IPFS).
*   **Enterprise Ready:** Enables audit trails for accountability in critical AI workflows.
*   **Framework Agnostic:** Works as a drop-in replacement for standard vector databases in existing agent frameworks.

## 🏗️ Architecture

```text
+----------------+       +---------------------+       +---------------------+
|   AI Agent     |       |  StateSync Middleware|       |  Blockchain Layer   |
| (Node.js)      |<----->| (Orchestration)      |<----->| (Ethereum + IPFS)   |
+-------+--------+       +----------+----------+       +----------+----------+
        |                          |                           |
        | 1. Request Memory        | 2. Compute Hash Chain     | 3. Store Hash & Metadata
        v                          v                           v
+-------+--------+       +----------+----------+       +----------+----------+
|  Local Context |       |  MemoryHashChaining |       |  MemoryRegistry.sol |
|  (Vector DB)   |       |  (services/)        |       |  (Contracts/)       |
+----------------+       +---------------------+       +---------------------+
        |                          |                           |
        | 4. Verify Integrity      | 5. Retrieve Chain         | 6. Query Ledger
        v                          v                           v
+-------+--------+       +----------+----------+       +----------+----------+
|  Dashboard     |       |  IPFS Gateway       |       |  Block Explorer     |
| (HTML/JS)      |       |  (Off-chain Data)   |       |  (Verification)     |
+----------------+       +---------------------+       +---------------------+
```

## 🛠️ Tech Stack
*   **Backend:** Node.js, Express
*   **Smart Contracts:** Solidity (Ethereum)
*   **Storage:** IPFS (Filecoin), Ethereum (State)
*   **Frontend:** HTML5, Vanilla JS, CSS3
*   **Agent Framework:** AutoGen Compatible
*   **Security:** Cryptographic Hashing (SHA-256), Private Key Management

## 📦 Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/77svene/state-sync-agent
cd state-sync-agent
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Create a `.env` file in the root directory based on `.env.example`:
```env
# Blockchain Configuration
PRIVATE_KEY=your_ethereum_private_key
RPC_URL=https://goerli.infura.io/v3/your_infura_key
CONTRACT_ADDRESS=0xYourDeployedContractAddress

# IPFS Configuration
IPFS_GATEWAY=https://ipfs.io/ipfs
IPFS_API_URL=https://api.ipfs.io

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 4. Deploy Contracts (Optional for Local Dev)
```bash
npx hardhat run scripts/deploy.js --network goerli
```

### 5. Start the Application
```bash
npm start
```
*Access the dashboard at `http://localhost:3000`*

## 🔌 API Endpoints

| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/memory` | Store new memory entry (hash + metadata) | Bearer Token |
| `GET` | `/api/chain/:id` | Retrieve full memory chain for an agent ID | Bearer Token |
| `POST` | `/api/verify` | Verify integrity of a specific memory hash | None |
| `GET` | `/api/status` | Check blockchain connection and contract status | None |
| `POST` | `/api/ipfs/upload` | Upload raw memory payload to IPFS (Off-chain) | Bearer Token |

## 📸 Demo Screenshots

### StateSync Verification Dashboard
<img src="./public/dashboard.png" alt="StateSync Dashboard showing memory chain verification" width="800" />
*Figure 1: Real-time verification of agent memory chain integrity.*

### Memory Hash Chaining Visualization
<img src="./public/chain-viz.png" alt="Visual representation of the hash chain" width="800" />
*Figure 2: Visualizing the cryptographic link between memory states.*

## 👥 Team

**Built by VARAKH BUILDER — autonomous AI agent**

*   **Core Logic:** Auto-generated by VARAKH BUILDER
*   **Smart Contracts:** Solidity Optimized
*   **Middleware:** Node.js Orchestration

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
*StateSync: Making AI Memory Trustworthy.*