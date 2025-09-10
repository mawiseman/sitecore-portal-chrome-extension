/**
 * Storage Consistency Manager
 * Handles atomic updates, version control, optimistic locking, and data integrity
 */

class StorageConsistencyManager {
  constructor() {
    this.logger = Logger.createContextLogger('StorageConsistencyManager');
    
    // Lock management
    this.locks = new Map();
    this.lockTimeout = CONFIG.get('TIMEOUTS.API_REQUEST', 30000);
    
    // Version tracking
    this.versions = new Map();
    this.versionKey = '_version';
    
    // Transaction management
    this.pendingTransactions = new Map();
    this.transactionSequence = 0;
    
    // Configuration
    this.config = {
      maxRetries: CONFIG.get('LIMITS.MAX_RETRIES', 3),
      retryDelay: CONFIG.get('TIMEOUTS.RETRY_DELAY_BASE', 1000),
      integrityCheckInterval: 300000, // 5 minutes
      backupRetention: 5
    };
    
    this.initializeConsistencyManagement();
  }

  /**
   * Initialize consistency management
   */
  initializeConsistencyManagement() {
    // Periodic integrity checks
    setInterval(() => {
      this.performIntegrityCheck();
    }, this.config.integrityCheckInterval);

    this.logger.info('Storage consistency management initialized');
  }

  /**
   * Acquire lock for a storage key
   * @param {string} key - Storage key to lock
   * @param {string} operation - Operation description
   * @param {number} timeout - Lock timeout in milliseconds
   * @returns {Promise<string>} Lock ID if successful
   */
  async acquireLock(key, operation = 'unknown', timeout = this.lockTimeout) {
    const lockId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    // Wait for existing lock to release
    while (this.locks.has(key)) {
      if (Date.now() - startTime > timeout) {
        throw new Error(`Failed to acquire lock for ${key} within timeout`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Acquire lock
    const lockInfo = {
      id: lockId,
      key,
      operation,
      acquiredAt: Date.now(),
      timeout: timeout
    };

    this.locks.set(key, lockInfo);
    
    // Set up automatic release
    setTimeout(() => {
      this.releaseLock(key, lockId);
    }, timeout);

    this.logger.debug('Lock acquired', { key, lockId, operation });
    return lockId;
  }

  /**
   * Release lock for a storage key
   * @param {string} key - Storage key
   * @param {string} lockId - Lock identifier
   * @returns {boolean} True if lock was released
   */
  releaseLock(key, lockId) {
    const lock = this.locks.get(key);
    
    if (!lock) {
      this.logger.debug('Attempted to release non-existent lock', { key, lockId });
      return false;
    }

    if (lock.id !== lockId) {
      this.logger.warn('Lock ID mismatch during release', { 
        key, 
        expectedId: lockId, 
        actualId: lock.id 
      });
      return false;
    }

    this.locks.delete(key);
    this.logger.debug('Lock released', { key, lockId, duration: Date.now() - lock.acquiredAt });
    return true;
  }

  /**
   * Get current version of stored data
   * @param {string} key - Storage key
   * @returns {Promise<number>} Current version number
   */
  async getCurrentVersion(key) {
    try {
      const result = await contextValidator.safeStorageOperation(
        () => chrome.storage.local.get([key]),
        `get_version_${key}`
      );

      if (!result || !result[key]) {
        return 0; // New data starts at version 0
      }

      return result[key][this.versionKey] || 0;
    } catch (error) {
      this.logger.warn('Failed to get current version', { key, error: error.message });
      return 0;
    }
  }

  /**
   * Increment and return next version
   * @param {string} key - Storage key
   * @returns {number} Next version number
   */
  getNextVersion(key) {
    const currentVersion = this.versions.get(key) || 0;
    const nextVersion = currentVersion + 1;
    this.versions.set(key, nextVersion);
    return nextVersion;
  }

  /**
   * Perform atomic update with version control
   * @param {string} key - Storage key
   * @param {Function} updateFunction - Function that transforms the data
   * @param {Object} options - Update options
   * @returns {Promise<Object>} Update result
   */
  async atomicUpdate(key, updateFunction, options = {}) {
    const {
      operation = 'atomic_update',
      validateFunction = null,
      onConflict = 'retry',
      maxRetries = this.config.maxRetries
    } = options;

    let retryCount = 0;
    let lastError = null;

    while (retryCount <= maxRetries) {
      const lockId = await this.acquireLock(key, operation);
      const transactionId = this.startTransaction(key, operation);

      try {
        // Get current data and version
        const currentResult = await contextValidator.safeStorageOperation(
          () => chrome.storage.local.get([key]),
          `atomic_read_${key}`
        );

        const currentData = currentResult ? (currentResult[key] || {}) : {};
        const currentVersion = currentData[this.versionKey] || 0;

        // Check for version conflicts (optimistic locking)
        const expectedVersion = this.versions.get(key);
        if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
          throw new StorageConflictError(`Version conflict for ${key}: expected ${expectedVersion}, found ${currentVersion}`);
        }

        // Create backup
        const backup = this.createBackup(key, currentData, currentVersion);

        // Apply update function
        const updatedData = await updateFunction(JSON.parse(JSON.stringify(currentData)));

        // Validate updated data
        if (validateFunction) {
          const validationResult = await validateFunction(updatedData, currentData);
          if (!validationResult.valid) {
            throw new ValidationError(`Validation failed: ${validationResult.error}`);
          }
        }

        // Increment version and add metadata
        const nextVersion = this.getNextVersion(key);
        updatedData[this.versionKey] = nextVersion;
        updatedData._lastModified = Date.now();
        updatedData._transaction = transactionId;

        // Perform atomic write
        const writeResult = await contextValidator.safeStorageOperation(
          () => chrome.storage.local.set({ [key]: updatedData }),
          `atomic_write_${key}`
        );

        if (!writeResult) {
          throw new Error('Storage write operation failed');
        }

        // Verify write
        const verifyResult = await contextValidator.safeStorageOperation(
          () => chrome.storage.local.get([key]),
          `atomic_verify_${key}`
        );

        const writtenData = verifyResult ? verifyResult[key] : null;
        if (!writtenData || writtenData[this.versionKey] !== nextVersion) {
          throw new Error('Write verification failed');
        }

        // Success
        this.completeTransaction(transactionId, 'success');
        this.releaseLock(key, lockId);

        this.logger.info('Atomic update successful', {
          key,
          operation,
          version: nextVersion,
          transactionId,
          attempt: retryCount + 1
        });

        return {
          success: true,
          version: nextVersion,
          data: updatedData,
          transactionId,
          backup
        };

      } catch (error) {
        lastError = error;
        this.completeTransaction(transactionId, 'failed', error);
        this.releaseLock(key, lockId);

        if (error instanceof StorageConflictError && onConflict === 'retry') {
          retryCount++;
          const delay = this.config.retryDelay * Math.pow(2, retryCount - 1); // Exponential backoff
          
          this.logger.warn('Storage conflict detected, retrying', {
            key,
            operation,
            error: error.message,
            attempt: retryCount,
            maxRetries,
            delayMs: delay
          });

          if (retryCount <= maxRetries) {
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        // Handle non-retryable errors or max retries exceeded
        this.logger.error('Atomic update failed', {
          key,
          operation,
          error: error.message,
          transactionId,
          finalAttempt: retryCount + 1
        });

        throw error;
      }
    }

    throw lastError || new Error('Atomic update failed after all retries');
  }

  /**
   * Start a new transaction
   * @param {string} key - Storage key
   * @param {string} operation - Operation description
   * @returns {string} Transaction ID
   */
  startTransaction(key, operation) {
    const transactionId = `tx_${++this.transactionSequence}_${Date.now()}`;
    
    const transaction = {
      id: transactionId,
      key,
      operation,
      startTime: Date.now(),
      status: 'active'
    };

    this.pendingTransactions.set(transactionId, transaction);
    
    this.logger.debug('Transaction started', { transactionId, key, operation });
    return transactionId;
  }

  /**
   * Complete a transaction
   * @param {string} transactionId - Transaction identifier
   * @param {string} status - Final status
   * @param {Error} error - Error if failed
   */
  completeTransaction(transactionId, status, error = null) {
    const transaction = this.pendingTransactions.get(transactionId);
    
    if (!transaction) {
      this.logger.warn('Attempted to complete non-existent transaction', { transactionId });
      return;
    }

    transaction.status = status;
    transaction.endTime = Date.now();
    transaction.duration = transaction.endTime - transaction.startTime;
    
    if (error) {
      transaction.error = error.message;
    }

    // Move to history and remove from pending
    this.pendingTransactions.delete(transactionId);
    
    this.logger.debug('Transaction completed', {
      transactionId,
      status,
      duration: transaction.duration,
      key: transaction.key
    });
  }

  /**
   * Create backup of current data
   * @param {string} key - Storage key
   * @param {Object} data - Current data
   * @param {number} version - Current version
   * @returns {Object} Backup information
   */
  createBackup(key, data, version) {
    const backupId = `backup_${key}_${version}_${Date.now()}`;
    const backup = {
      id: backupId,
      key,
      version,
      data: JSON.parse(JSON.stringify(data)),
      createdAt: Date.now()
    };

    // Store backup (in memory for now, could be persisted)
    this.storeBackup(backup);

    return backup;
  }

  /**
   * Store backup with retention management
   * @param {Object} backup - Backup object
   */
  storeBackup(backup) {
    const backupKey = `_backups_${backup.key}`;
    
    // Get existing backups for this key
    const existingBackups = this.getBackups(backup.key);
    existingBackups.push(backup);

    // Keep only recent backups
    const recentBackups = existingBackups
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, this.config.backupRetention);

    // Store in memory (could be enhanced to persist to storage)
    if (!window._storageBackups) {
      window._storageBackups = new Map();
    }
    window._storageBackups.set(backupKey, recentBackups);
  }

  /**
   * Get backups for a key
   * @param {string} key - Storage key
   * @returns {Array} Array of backups
   */
  getBackups(key) {
    const backupKey = `_backups_${key}`;
    return window._storageBackups?.get(backupKey) || [];
  }

  /**
   * Rollback to a previous version
   * @param {string} key - Storage key
   * @param {number} targetVersion - Version to rollback to
   * @returns {Promise<Object>} Rollback result
   */
  async rollback(key, targetVersion) {
    const backups = this.getBackups(key);
    const targetBackup = backups.find(backup => backup.version === targetVersion);

    if (!targetBackup) {
      throw new Error(`No backup found for version ${targetVersion}`);
    }

    this.logger.info('Performing rollback', { key, targetVersion });

    // Use atomic update to perform rollback
    return await this.atomicUpdate(key, () => {
      return targetBackup.data;
    }, {
      operation: `rollback_to_v${targetVersion}`,
      validateFunction: async (data) => ({ valid: true })
    });
  }

  /**
   * Perform integrity check on stored data
   */
  async performIntegrityCheck() {
    try {
      const organizationsKey = CONFIG.get('STORAGE.ORGANIZATIONS_KEY');
      const organizations = await storageManager.getOrganizations();

      let issuesFound = 0;
      const issues = [];

      // Check data structure integrity
      if (!Array.isArray(organizations)) {
        issues.push('Organizations data is not an array');
        issuesFound++;
      }

      // Check individual organization integrity
      for (let i = 0; i < organizations.length; i++) {
        const org = organizations[i];
        
        if (!org.id) {
          issues.push(`Organization at index ${i} missing required 'id' field`);
          issuesFound++;
        }
        
        if (!org.name && !org.displayName) {
          issues.push(`Organization ${org.id || i} missing name fields`);
          issuesFound++;
        }
        
        if (org.productGroups && !Array.isArray(org.productGroups)) {
          issues.push(`Organization ${org.id} has invalid productGroups structure`);
          issuesFound++;
        }
      }

      // Check for duplicate IDs
      const ids = organizations.map(org => org.id).filter(Boolean);
      const uniqueIds = new Set(ids);
      if (ids.length !== uniqueIds.size) {
        issues.push('Duplicate organization IDs found');
        issuesFound++;
      }

      if (issuesFound > 0) {
        this.logger.warn('Data integrity issues detected', {
          issuesCount: issuesFound,
          issues: issues.slice(0, 10) // Limit logged issues
        });
      } else {
        this.logger.debug('Data integrity check passed');
      }

      return {
        passed: issuesFound === 0,
        issuesFound,
        issues
      };

    } catch (error) {
      this.logger.error('Integrity check failed', error);
      return {
        passed: false,
        issuesFound: -1,
        error: error.message
      };
    }
  }

  /**
   * Get consistency statistics
   * @returns {Object} Statistics object
   */
  getStatistics() {
    return {
      activeLocks: this.locks.size,
      pendingTransactions: this.pendingTransactions.size,
      versionedKeys: this.versions.size,
      lockDetails: Array.from(this.locks.entries()).map(([key, lock]) => ({
        key,
        lockId: lock.id,
        operation: lock.operation,
        age: Date.now() - lock.acquiredAt
      })),
      transactionDetails: Array.from(this.pendingTransactions.values()).map(tx => ({
        id: tx.id,
        key: tx.key,
        operation: tx.operation,
        age: Date.now() - tx.startTime,
        status: tx.status
      }))
    };
  }

  /**
   * Cleanup method for destruction
   */
  destroy() {
    this.logger.info('Destroying storage consistency manager');
    
    // Release all locks
    for (const [key, lock] of this.locks.entries()) {
      this.releaseLock(key, lock.id);
    }

    // Clear pending transactions
    this.pendingTransactions.clear();
    this.versions.clear();
  }
}

// Custom error classes
class StorageConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageConflictError';
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    StorageConsistencyManager,
    StorageConflictError,
    ValidationError
  };
}