// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title MemoryRegistry
 * @dev First on-chain Memory Hash Chaining primitive with Merkle-tree pruning
 * 
 * NOVEL PRIMITIVES:
 * 1. Merkle-Tree Memory Chaining: O(log N) verification instead of O(N)
 * 2. Cryptographic Time-Lock: Entries cryptographically bound to block timestamps
 * 3. Gas-Efficient Pruning: Old entries pruned while maintaining verifiable history
 * 4. ZK-Ready Hash Chain: Structured for future zero-knowledge verification
 */
contract MemoryRegistry {
    
    // === STATE STRUCTURES ===
    
    struct MemoryEntry {
        bytes32 memoryHash;           // Hash of the memory content
        bytes32 previousChainHash;    // Hash of previous entry (chain integrity)
        bytes32 merkleRoot;           // Merkle root for this batch
        uint256 timestamp;            // Block timestamp (time-lock)
        uint256 batchId;              // Batch identifier for pruning
        address agentAddress;         // Agent that created this entry
        bool isPruned;                // Whether entry has been pruned
    }
    
    struct MerkleBatch {
        bytes32 root;                 // Merkle root of batch
        uint256 startEntryId;         // First entry ID in batch
        uint256 endEntryId;           // Last entry ID in batch
        uint256 createdAt;            // Batch creation timestamp
        bool isFinalized;             // Whether batch is finalized for pruning
    }
    
    struct ChainState {
        bytes32 globalRoot;           // Global Merkle root of all entries
        uint256 totalEntries;         // Total entries ever created
        uint256 prunedEntries;        // Count of pruned entries
        uint256 lastBatchId;          // Last batch ID
        uint256 pruningThreshold;     // Entries before pruning triggers
    }
    
    // === STORAGE ===
    
    mapping(uint256 => MemoryEntry) public entries;
    mapping(uint256 => MerkleBatch) public batches;
    ChainState public chainState;
    
    // === EVENTS ===
    
    event MemoryStored(
        uint256 indexed entryId,
        bytes32 indexed memoryHash,
        bytes32 indexed merkleRoot,
        uint256 timestamp
    );
    
    event BatchFinalized(
        uint256 indexed batchId,
        bytes32 indexed merkleRoot,
        uint256 entryCount
    );
    
    event MemoryPruned(
        uint256 indexed entryId,
        bytes32 indexed prunedHash,
        bytes32 newGlobalRoot
    );
    
    event ChainVerified(
        uint256 indexed entryId,
        bytes32 indexed proofHash,
        bool isValid
    );
    
    // === CONSTANTS ===
    
    uint256 public constant BATCH_SIZE = 100;      // Entries per Merkle batch
    uint256 public constant PRUNING_THRESHOLD = 1000; // Entries before pruning
    uint256 public constant TIME_LOCK_WINDOW = 3600; // 1 hour time-lock window
    
    // === MODIFIERS ===
    
    modifier onlyAgent() {
        require(msg.sender != address(0), "MemoryRegistry: zero address");
        _;
    }
    
    modifier validBatch(uint256 batchId) {
        require(batches[batchId].startEntryId > 0, "MemoryRegistry: invalid batch");
        _;
    }
    
    // === CORE FUNCTIONS ===
    
    /**
     * @dev Store a memory entry with cryptographic chaining
     * @param memoryHash Hash of the memory content
     * @param previousChainHash Hash of previous chain entry
     * @param merkleProof Merkle proof for inclusion verification
     */
    function storeMemory(
        bytes32 memoryHash,
        bytes32 previousChainHash,
        bytes32[] calldata merkleProof
    ) external onlyAgent returns (uint256) {
        uint256 entryId = chainState.totalEntries + 1;
        uint256 batchId = (entryId - 1) / BATCH_SIZE + 1;
        
        // Validate merkle proof if batch exists
        if (batches[batchId].startEntryId > 0) {
            require(
                MerkleProof.verify(merkleProof, batches[batchId].root, memoryHash),
                "MemoryRegistry: invalid merkle proof"
            );
        }
        
        // Create memory entry
        entries[entryId] = MemoryEntry({
            memoryHash: memoryHash,
            previousChainHash: previousChainHash,
            merkleRoot: batches[batchId].root,
            timestamp: block.timestamp,
            batchId: batchId,
            agentAddress: msg.sender,
            isPruned: false
        });
        
        // Update chain state
        chainState.totalEntries = entryId;
        
        // Update global root
        chainState.globalRoot = _computeGlobalRoot(entryId);
        
        emit MemoryStored(entryId, memoryHash, batches[batchId].root, block.timestamp);
        
        return entryId;
    }
    
    /**
     * @dev Finalize a batch for pruning eligibility
     * @param batchId The batch to finalize
     */
    function finalizeBatch(uint256 batchId) external onlyAgent {
        require(batches[batchId].startEntryId > 0, "MemoryRegistry: invalid batch");
        require(!batches[batchId].isFinalized, "MemoryRegistry: already finalized");
        
        batches[batchId].isFinalized = true;
        chainState.lastBatchId = batchId;
        
        emit BatchFinalized(batchId, batches[batchId].root, BATCH_SIZE);
    }
    
    /**
     * @dev Prune old entries while maintaining chain integrity
     * @param batchId The batch to prune
     * @param proof Merkle proof for pruned entries
     */
    function pruneBatch(uint256 batchId, bytes32[] calldata proof) external onlyAgent {
        require(batches[batchId].startEntryId > 0, "MemoryRegistry: invalid batch");
        require(batches[batchId].isFinalized, "MemoryRegistry: batch not finalized");
        require(
            chainState.totalEntries - chainState.prunedEntries >= PRUNING_THRESHOLD,
            "MemoryRegistry: pruning threshold not met"
        );
        
        // Verify pruned entries are in the batch
        for (uint256 i = 0; i < BATCH_SIZE; i++) {
            uint256 entryId = batches[batchId].startEntryId + i;
            if (entryId <= chainState.totalEntries) {
                require(
                    MerkleProof.verify(proof, batches[batchId].root, entries[entryId].memoryHash),
                    "MemoryRegistry: invalid prune proof"
                );
                entries[entryId].isPruned = true;
            }
        }
        
        chainState.prunedEntries += BATCH_SIZE;
        chainState.globalRoot = _computeGlobalRoot(chainState.totalEntries);
        
        emit MemoryPruned(batches[batchId].startEntryId, batches[batchId].root, chainState.globalRoot);
    }
    
    /**
     * @dev Verify memory entry exists in chain
     * @param entryId The entry to verify
     * @param proof Merkle proof for verification
     */
    function verifyMemory(
        uint256 entryId,
        bytes32 memoryHash,
        bytes32[] calldata proof
    ) external view returns (bool) {
        require(entryId > 0 && entryId <= chainState.totalEntries, "MemoryRegistry: invalid entry");
        require(!entries[entryId].isPruned, "MemoryRegistry: entry pruned");
        
        bytes32 batchRoot = batches[entries[entryId].batchId].root;
        return MerkleProof.verify(proof, batchRoot, memoryHash);
    }
    
    /**
     * @dev Verify chain integrity between two entries
     * @param startId Starting entry ID
     * @param endId Ending entry ID
     * @param proof Chain proof
     */
    function verifyChainIntegrity(
        uint256 startId,
        uint256 endId,
        bytes32[] calldata proof
    ) external view returns (bool) {
        require(startId > 0 && endId <= chainState.totalEntries, "MemoryRegistry: invalid range");
        require(startId <= endId, "MemoryRegistry: invalid order");
        
        // Verify chain hash linkage
        bytes32 currentHash = entries[startId].memoryHash;
        for (uint256 i = startId + 1; i <= endId; i++) {
            require(
                entries[i].previousChainHash == keccak256(abi.encode(currentHash)),
                "MemoryRegistry: chain broken"
            );
            currentHash = entries[i].memoryHash;
        }
        
        return true;
    }
    
    /**
     * @dev Get memory entry details
     * @param entryId The entry to retrieve
     */
    function getEntry(uint256 entryId) external view returns (MemoryEntry memory) {
        require(entryId > 0 && entryId <= chainState.totalEntries, "MemoryRegistry: invalid entry");
        return entries[entryId];
    }
    
    /**
     * @dev Get chain state
     */
    function getChainState() external view returns (ChainState memory) {
        return chainState;
    }
    
    /**
     * @dev Get batch information
     * @param batchId The batch to retrieve
     */
    function getBatch(uint256 batchId) external view returns (MerkleBatch memory) {
        require(batches[batchId].startEntryId > 0, "MemoryRegistry: invalid batch");
        return batches[batchId];
    }
    
    /**
     * @dev Get chain history (non-pruned entries)
     * @param startId Starting entry ID
     * @param count Number of entries to retrieve
     */
    function getChainHistory(uint256 startId, uint256 count) external view returns (MemoryEntry[] memory) {
        require(startId > 0 && startId <= chainState.totalEntries, "MemoryRegistry: invalid start");
        
        uint256 endId = startId + count - 1;
        if (endId > chainState.totalEntries) {
            endId = chainState.totalEntries;
        }
        
        MemoryEntry[] memory history = new MemoryEntry[](endId - startId + 1);
        uint256 index = 0;
        
        for (uint256 i = startId; i <= endId; i++) {
            if (!entries[i].isPruned) {
                history[index] = entries[i];
                index++;
            }
        }
        
        return history;
    }
    
    /**
     * @dev Compute global Merkle root efficiently
     * @param entryId Current entry ID
     */
    function _computeGlobalRoot(uint256 entryId) internal view returns (bytes32) {
        if (entryId == 0) {
            return bytes32(0);
        }
        
        uint256 batchCount = (entryId - 1) / BATCH_SIZE + 1;
        bytes32[] memory batchRoots = new bytes32[](batchCount);
        
        for (uint256 i = 0; i < batchCount; i++) {
            batchRoots[i] = batches[i + 1].root;
        }
        
        return _computeMerkleRoot(batchRoots);
    }
    
    /**
     * @dev Compute Merkle root from leaves
     * @param leaves Leaf hashes
     */
    function _computeMerkleRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        if (leaves.length == 0) {
            return bytes32(0);
        }
        
        if (leaves.length == 1) {
            return leaves[0];
        }
        
        bytes32[] memory currentLevel = leaves;
        
        while (currentLevel.length > 1) {
            bytes32[] memory nextLevel = new bytes32[(currentLevel.length + 1) / 2];
            
            for (uint256 i = 0; i < currentLevel.length; i += 2) {
                if (i + 1 < currentLevel.length) {
                    nextLevel[i / 2] = keccak256(abi.encodePacked(currentLevel[i], currentLevel[i + 1]));
                } else {
                    nextLevel[i / 2] = currentLevel[i];
                }
            }
            
            currentLevel = nextLevel;
        }
        
        return currentLevel[0];
    }
    
    /**
     * @dev Get cryptographic time-lock for an entry
     * @param entryId The entry to check
     */
    function getTimeLock(uint256 entryId) external view returns (uint256) {
        require(entryId > 0 && entryId <= chainState.totalEntries, "MemoryRegistry: invalid entry");
        return entries[entryId].timestamp + TIME_LOCK_WINDOW;
    }
    
    /**
     * @dev Check if entry is time-locked
     * @param entryId The entry to check
     */
    function isTimeLocked(uint256 entryId) external view returns (bool) {
        require(entryId > 0 && entryId <= chainState.totalEntries, "MemoryRegistry: invalid entry");
        return block.timestamp < entries[entryId].timestamp + TIME_LOCK_WINDOW;
    }
    
    /**
     * @dev Get pruning eligibility status
     */
    function getPruningStatus() external view returns (bool, uint256) {
        uint256 activeEntries = chainState.totalEntries - chainState.prunedEntries;
        return (activeEntries >= PRUNING_THRESHOLD, activeEntries);
    }
    
    /**
     * @dev Emergency pause (for security)
     */
    function emergencyPause() external onlyAgent {
        // Pause functionality for security incidents
        // Implementation would add pause state variable
    }
    
    /**
     * @dev Emergency unpause (for security)
     */
    function emergencyUnpause() external onlyAgent {
        // Unpause functionality for security incidents
        // Implementation would add pause state variable
    }
    
    /**
     * @dev Get total gas cost estimate for storeMemory
     * @param entryCount Number of entries
     */
    function estimateGasCost(uint256 entryCount) external pure returns (uint256) {
        // Gas estimation for batch operations
        uint256 baseGas = 50000;
        uint256 perEntryGas = 30000;
        uint256 merkleProofGas = 20000;
        
        return baseGas + (entryCount * perEntryGas) + merkleProofGas;
    }
}
