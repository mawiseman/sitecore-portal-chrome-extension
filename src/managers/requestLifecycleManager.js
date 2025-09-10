/**
 * Request Lifecycle Manager
 * Handles request state tracking, race condition prevention, and cleanup coordination
 */

class RequestLifecycleManager {
  constructor() {
    this.logger = Logger.createContextLogger('RequestLifecycleManager');
    
    // Request tracking
    this.activeRequests = new Map();
    this.requestHistory = new Map(); // Keep limited history for debugging
    this.requestSequence = 0;
    
    // State management
    this.cleanupInProgress = false;
    this.shutdownInitiated = false;
    
    // Configuration
    this.config = {
      requestTimeout: CONFIG.get('TIMEOUTS.API_REQUEST', 30000),
      cleanupInterval: CONFIG.get('TIMEOUTS.STORAGE_CLEANUP', 60000),
      maxHistorySize: CONFIG.get('LIMITS.MAX_LOG_ENTRIES', 100),
      gracefulShutdownTimeout: 5000
    };
    
    this.initializeLifecycleManagement();
  }

  /**
   * Initialize lifecycle management
   */
  initializeLifecycleManagement() {
    // Set up periodic cleanup with race condition protection
    this.cleanupInterval = setInterval(() => {
      this.performSafeCleanup();
    }, this.config.cleanupInterval);

    // Handle extension shutdown
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        chrome.runtime.onSuspend.addListener(() => {
          this.initiateGracefulShutdown();
        });
      } catch (error) {
        this.logger.debug('Could not register onSuspend listener (not in service worker context)');
      }
    }

    this.logger.info('Request lifecycle management initialized');
  }

  /**
   * Register a new request
   * @param {string} requestId - Unique request identifier
   * @param {Object} requestInfo - Request information
   * @returns {Object} Request tracking object
   */
  registerRequest(requestId, requestInfo) {
    const sequence = ++this.requestSequence;
    const timestamp = Date.now();
    
    const request = {
      id: requestId,
      sequence,
      timestamp,
      status: 'pending',
      type: requestInfo.type,
      url: requestInfo.url,
      tabId: requestInfo.tabId,
      timeoutHandle: null,
      startTime: timestamp,
      metadata: requestInfo.metadata || {}
    };

    // Set up timeout handling
    request.timeoutHandle = setTimeout(() => {
      this.handleRequestTimeout(requestId);
    }, this.config.requestTimeout);

    this.activeRequests.set(requestId, request);
    
    this.logger.debug('Request registered', {
      requestId,
      sequence,
      type: request.type,
      activeCount: this.activeRequests.size
    });

    return request;
  }

  /**
   * Update request status
   * @param {string} requestId - Request identifier
   * @param {string} status - New status
   * @param {Object} additionalData - Additional data to merge
   */
  updateRequestStatus(requestId, status, additionalData = {}) {
    const request = this.activeRequests.get(requestId);
    
    if (!request) {
      this.logger.warn('Attempted to update non-existent request', { requestId, status });
      return false;
    }

    // Prevent status updates during shutdown
    if (this.shutdownInitiated && status !== 'cancelled') {
      this.logger.debug('Ignoring status update during shutdown', { requestId, status });
      return false;
    }

    const previousStatus = request.status;
    request.status = status;
    request.lastUpdated = Date.now();
    request.duration = request.lastUpdated - request.startTime;
    
    // Merge additional data
    Object.assign(request, additionalData);

    this.logger.debug('Request status updated', {
      requestId,
      previousStatus,
      newStatus: status,
      duration: request.duration,
      sequence: request.sequence
    });

    // Handle completion states
    if (this.isCompletedStatus(status)) {
      this.completeRequest(requestId);
    }

    return true;
  }

  /**
   * Mark request as completed and move to history
   * @param {string} requestId - Request identifier
   */
  completeRequest(requestId) {
    const request = this.activeRequests.get(requestId);
    
    if (!request) {
      return false;
    }

    // Clear timeout
    if (request.timeoutHandle) {
      clearTimeout(request.timeoutHandle);
      request.timeoutHandle = null;
    }

    // Move to history (with size limit)
    request.completedAt = Date.now();
    this.addToHistory(request);

    // Remove from active requests
    this.activeRequests.delete(requestId);

    this.logger.debug('Request completed', {
      requestId,
      status: request.status,
      duration: request.duration,
      activeCount: this.activeRequests.size
    });

    return true;
  }

  /**
   * Handle request timeout
   * @param {string} requestId - Request identifier
   */
  handleRequestTimeout(requestId) {
    const request = this.activeRequests.get(requestId);
    
    if (!request) {
      return; // Request was already completed
    }

    this.logger.warn('Request timed out', {
      requestId,
      type: request.type,
      duration: Date.now() - request.startTime,
      status: request.status
    });

    // Update status and complete
    this.updateRequestStatus(requestId, 'timeout', {
      timeoutReason: 'request_timeout',
      timeoutAfter: this.config.requestTimeout
    });
  }

  /**
   * Check if status indicates completion
   * @param {string} status - Status to check
   * @returns {boolean} True if completed
   */
  isCompletedStatus(status) {
    return ['completed', 'failed', 'timeout', 'cancelled', 'error'].includes(status);
  }

  /**
   * Add request to history with size management
   * @param {Object} request - Completed request
   */
  addToHistory(request) {
    // Clean sensitive data before storing in history
    const historyEntry = {
      id: request.id,
      sequence: request.sequence,
      type: request.type,
      status: request.status,
      startTime: request.startTime,
      completedAt: request.completedAt,
      duration: request.duration,
      url: request.url ? new URL(request.url).pathname : null // Store only path for privacy
    };

    this.requestHistory.set(request.id, historyEntry);

    // Maintain history size limit
    if (this.requestHistory.size > this.config.maxHistorySize) {
      const oldestKey = this.requestHistory.keys().next().value;
      this.requestHistory.delete(oldestKey);
    }
  }

  /**
   * Get active request information
   * @param {string} requestId - Request identifier
   * @returns {Object|null} Request info or null
   */
  getActiveRequest(requestId) {
    return this.activeRequests.get(requestId) || null;
  }

  /**
   * Get all active requests
   * @returns {Array} Array of active requests
   */
  getActiveRequests() {
    return Array.from(this.activeRequests.values());
  }

  /**
   * Check if any requests are active
   * @returns {boolean} True if requests are active
   */
  hasActiveRequests() {
    return this.activeRequests.size > 0;
  }

  /**
   * Get requests by type
   * @param {string} type - Request type to filter by
   * @returns {Array} Filtered requests
   */
  getRequestsByType(type) {
    return this.getActiveRequests().filter(req => req.type === type);
  }

  /**
   * Perform safe cleanup that doesn't interfere with active requests
   */
  async performSafeCleanup() {
    if (this.cleanupInProgress) {
      this.logger.debug('Cleanup already in progress, skipping');
      return;
    }

    this.cleanupInProgress = true;
    
    try {
      const now = Date.now();
      let cleanedCount = 0;

      // Only clean up truly stale requests (much older than timeout)
      const staleThreshold = this.config.requestTimeout * 2;

      for (const [requestId, request] of this.activeRequests.entries()) {
        const age = now - request.timestamp;
        
        // Only clean up requests that are very old and likely abandoned
        if (age > staleThreshold && request.status === 'pending') {
          this.logger.warn('Cleaning up stale request', {
            requestId,
            age,
            type: request.type,
            status: request.status
          });

          this.updateRequestStatus(requestId, 'stale_cleanup', {
            cleanupReason: 'periodic_stale_cleanup',
            ageAtCleanup: age
          });
          
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.info('Stale request cleanup completed', { cleanedCount });
      }

      // Clean up old history entries
      this.cleanupHistory();

    } catch (error) {
      this.logger.error('Error during safe cleanup', error);
    } finally {
      this.cleanupInProgress = false;
    }
  }

  /**
   * Clean up old history entries
   */
  cleanupHistory() {
    const maxAge = this.config.cleanupInterval * 10; // Keep history for 10 cleanup cycles
    const cutoffTime = Date.now() - maxAge;
    let removedCount = 0;

    for (const [requestId, entry] of this.requestHistory.entries()) {
      if (entry.completedAt < cutoffTime) {
        this.requestHistory.delete(requestId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.debug('History cleanup completed', { removedCount });
    }
  }

  /**
   * Initiate graceful shutdown
   */
  async initiateGracefulShutdown() {
    this.shutdownInitiated = true;
    this.logger.info('Initiating graceful shutdown', {
      activeRequests: this.activeRequests.size
    });

    // Stop periodic cleanup
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Cancel all pending requests
    const cancelledRequests = [];
    for (const [requestId, request] of this.activeRequests.entries()) {
      if (request.status === 'pending') {
        this.updateRequestStatus(requestId, 'cancelled', {
          cancellationReason: 'graceful_shutdown'
        });
        cancelledRequests.push(requestId);
      }
    }

    if (cancelledRequests.length > 0) {
      this.logger.info('Cancelled requests during shutdown', {
        count: cancelledRequests.length,
        requestIds: cancelledRequests
      });
    }

    // Wait briefly for any cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    this.logger.info('Graceful shutdown completed');
  }

  /**
   * Check if it's safe to perform operations
   * @returns {boolean} True if safe to operate
   */
  isSafeToOperate() {
    return !this.shutdownInitiated && !this.cleanupInProgress;
  }

  /**
   * Wait for safe operation window
   * @param {number} maxWait - Maximum time to wait in milliseconds
   * @returns {Promise<boolean>} True if became safe, false if timeout
   */
  async waitForSafeOperation(maxWait = 5000) {
    const startTime = Date.now();
    
    while (!this.isSafeToOperate() && (Date.now() - startTime) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return this.isSafeToOperate();
  }

  /**
   * Get lifecycle statistics
   * @returns {Object} Statistics object
   */
  getStatistics() {
    const activeRequests = this.getActiveRequests();
    const activeByType = {};
    const activeByStatus = {};

    activeRequests.forEach(req => {
      activeByType[req.type] = (activeByType[req.type] || 0) + 1;
      activeByStatus[req.status] = (activeByStatus[req.status] || 0) + 1;
    });

    return {
      activeRequestCount: this.activeRequests.size,
      historySize: this.requestHistory.size,
      nextSequence: this.requestSequence + 1,
      activeByType,
      activeByStatus,
      cleanupInProgress: this.cleanupInProgress,
      shutdownInitiated: this.shutdownInitiated,
      isSafeToOperate: this.isSafeToOperate()
    };
  }

  /**
   * Cleanup method for destruction
   */
  destroy() {
    this.logger.info('Destroying request lifecycle manager');
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Clear all timeouts
    for (const request of this.activeRequests.values()) {
      if (request.timeoutHandle) {
        clearTimeout(request.timeoutHandle);
      }
    }

    this.activeRequests.clear();
    this.requestHistory.clear();
  }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RequestLifecycleManager;
}