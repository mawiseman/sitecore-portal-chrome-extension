/**
 * Centralized Error Handling Service for Chrome Extension
 * Provides consistent error handling, user-friendly messages, and recovery mechanisms
 */

class ErrorHandler {
  constructor() {
    this.logger = Logger.createContextLogger('ErrorHandler');
    this.errorCounts = new Map();
    this.recoveryStrategies = new Map();
    this.userNotificationQueue = [];
    this.isProcessingNotifications = false;
    
    this.setupGlobalErrorHandlers();
    this.initializeRecoveryStrategies();
  }

  /**
   * Error types and their user-friendly messages
   */
  static ERROR_TYPES = {
    NETWORK_ERROR: {
      code: 'NETWORK_ERROR',
      title: 'Connection Issue',
      message: 'Unable to connect to Sitecore services. Please check your internet connection.',
      recoverable: true,
      maxRetries: 3
    },
    API_ERROR: {
      code: 'API_ERROR',
      title: 'Service Error',
      message: 'Sitecore service is temporarily unavailable. Please try again later.',
      recoverable: true,
      maxRetries: 2
    },
    STORAGE_ERROR: {
      code: 'STORAGE_ERROR',
      title: 'Storage Issue',
      message: 'Unable to save your data. Please try refreshing the extension.',
      recoverable: true,
      maxRetries: 2
    },
    VALIDATION_ERROR: {
      code: 'VALIDATION_ERROR',
      title: 'Invalid Data',
      message: 'The data provided is not valid. Please check your input.',
      recoverable: false,
      maxRetries: 0
    },
    PERMISSION_ERROR: {
      code: 'PERMISSION_ERROR',
      title: 'Permission Denied',
      message: 'Extension does not have permission to perform this action.',
      recoverable: false,
      maxRetries: 0
    },
    TIMEOUT_ERROR: {
      code: 'TIMEOUT_ERROR',
      title: 'Request Timeout',
      message: 'The operation took too long to complete. Please try again.',
      recoverable: true,
      maxRetries: 2
    },
    UNKNOWN_ERROR: {
      code: 'UNKNOWN_ERROR',
      title: 'Unexpected Error',
      message: 'An unexpected error occurred. Please try refreshing the extension.',
      recoverable: true,
      maxRetries: 1
    }
  };

  /**
   * Handle an error with automatic classification and recovery
   * @param {Error|string} error - The error to handle
   * @param {string} context - Context where the error occurred
   * @param {Object} metadata - Additional error metadata
   * @param {Function} recoveryCallback - Optional recovery function
   * @returns {Promise<boolean>} - True if error was recovered, false otherwise
   */
  async handleError(error, context = 'Unknown', metadata = {}, recoveryCallback = null) {
    const errorInfo = this.classifyError(error, context, metadata);
    const errorKey = `${errorInfo.type.code}_${context}`;
    
    // Track error frequency
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);
    
    // Properly serialize error object for logging
    let errorMessage = error;
    if (error && typeof error === 'object') {
      errorMessage = error.message || error.toString();
      // If it's still [object Object], try to stringify it
      if (errorMessage === '[object Object]') {
        try {
          errorMessage = JSON.stringify(error);
        } catch (e) {
          errorMessage = 'Complex error object (unable to serialize)';
        }
      }
    }
    
    // Log the error
    this.logger.error(`Error in ${context}`, {
      error: errorMessage,
      type: errorInfo.type.code,
      count: this.errorCounts.get(errorKey),
      metadata,
      stack: error.stack
    });

    // Attempt recovery if possible
    let recovered = false;
    if (errorInfo.type.recoverable && this.errorCounts.get(errorKey) <= errorInfo.type.maxRetries) {
      recovered = await this.attemptRecovery(errorInfo, context, recoveryCallback);
    }

    // Show user notification if not recovered or if this is a critical error
    if (!recovered || this.shouldNotifyUser(errorInfo, context)) {
      await this.notifyUser(errorInfo, context);
    }

    return recovered;
  }

  /**
   * Classify an error into a known type
   * @param {Error|string} error 
   * @param {string} context 
   * @param {Object} metadata 
   * @returns {Object} Error information object
   */
  classifyError(error, context, metadata) {
    const errorMessage = error.message || error.toString().toLowerCase();
    const errorStack = error.stack || '';

    let type = ErrorHandler.ERROR_TYPES.UNKNOWN_ERROR;

    // Network errors
    if (errorMessage.includes('fetch') || errorMessage.includes('network') || 
        errorMessage.includes('connection') || errorMessage.includes('timeout') ||
        errorMessage.includes('net::')) {
      type = ErrorHandler.ERROR_TYPES.NETWORK_ERROR;
    }
    // API errors
    else if (context.includes('api') || errorMessage.includes('api') || 
             errorMessage.includes('http') || errorMessage.includes('response')) {
      type = ErrorHandler.ERROR_TYPES.API_ERROR;
    }
    // Storage errors
    else if (context.includes('storage') || errorMessage.includes('storage') ||
             errorMessage.includes('quota') || errorMessage.includes('database')) {
      type = ErrorHandler.ERROR_TYPES.STORAGE_ERROR;
    }
    // Validation errors
    else if (errorMessage.includes('validation') || errorMessage.includes('invalid') ||
             errorMessage.includes('sanitiz') || context.includes('validation')) {
      type = ErrorHandler.ERROR_TYPES.VALIDATION_ERROR;
    }
    // Permission errors
    else if (errorMessage.includes('permission') || errorMessage.includes('denied') ||
             errorMessage.includes('unauthorized') || errorMessage.includes('forbidden')) {
      type = ErrorHandler.ERROR_TYPES.PERMISSION_ERROR;
    }
    // Timeout errors
    else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      type = ErrorHandler.ERROR_TYPES.TIMEOUT_ERROR;
    }

    return {
      type,
      originalError: error,
      context,
      metadata,
      timestamp: Date.now()
    };
  }

  /**
   * Attempt to recover from an error
   * @param {Object} errorInfo 
   * @param {string} context 
   * @param {Function} recoveryCallback 
   * @returns {Promise<boolean>}
   */
  async attemptRecovery(errorInfo, context, recoveryCallback) {
    this.logger.info(`Attempting recovery for ${errorInfo.type.code} in ${context}`);

    try {
      // Try custom recovery callback first
      if (recoveryCallback && typeof recoveryCallback === 'function') {
        const result = await recoveryCallback(errorInfo);
        if (result) {
          this.logger.info('Custom recovery successful', { context, type: errorInfo.type.code });
          return true;
        }
      }

      // Try built-in recovery strategies
      const strategy = this.recoveryStrategies.get(errorInfo.type.code);
      if (strategy) {
        const result = await strategy(errorInfo, context);
        if (result) {
          this.logger.info('Built-in recovery successful', { context, type: errorInfo.type.code });
          return true;
        }
      }

      return false;
    } catch (recoveryError) {
      this.logger.warn('Recovery attempt failed', { 
        context, 
        originalError: errorInfo.type.code,
        recoveryError: recoveryError.message 
      });
      return false;
    }
  }

  /**
   * Initialize recovery strategies for different error types
   */
  initializeRecoveryStrategies() {
    this.recoveryStrategies.set('NETWORK_ERROR', async (errorInfo, context) => {
      // Wait and retry for network errors
      await this.delay(1000 * Math.min(this.errorCounts.get(`${errorInfo.type.code}_${context}`) || 1, 5));
      return false; // Let the caller handle retry
    });

    this.recoveryStrategies.set('API_ERROR', async (errorInfo, context) => {
      // Clear any cached data that might be stale
      if (context.includes('organizations')) {
        try {
          await chrome.storage.local.remove(['organizations']);
          return true;
        } catch (e) {
          return false;
        }
      }
      return false;
    });

    this.recoveryStrategies.set('STORAGE_ERROR', async (errorInfo, context) => {
      // Try to clear storage quota issues
      try {
        const usage = await chrome.storage.local.getBytesInUse();
        if (usage > 5000000) { // 5MB threshold
          // Clear old data
          const result = await chrome.storage.local.get(['organizations']);
          if (result.organizations && Array.isArray(result.organizations)) {
            // Keep only recent organizations
            const recent = result.organizations
              .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
              .slice(0, 10);
            await chrome.storage.local.set({ organizations: recent });
            return true;
          }
        }
      } catch (e) {
        return false;
      }
      return false;
    });

    this.recoveryStrategies.set('TIMEOUT_ERROR', async (errorInfo, context) => {
      // Implement exponential backoff
      const attempt = this.errorCounts.get(`${errorInfo.type.code}_${context}`) || 1;
      await this.delay(1000 * Math.pow(2, attempt));
      return false; // Let caller retry
    });
  }

  /**
   * Determine if user should be notified about this error
   * @param {Object} errorInfo 
   * @param {string} context 
   * @returns {boolean}
   */
  shouldNotifyUser(errorInfo, context) {
    const errorKey = `${errorInfo.type.code}_${context}`;
    const count = this.errorCounts.get(errorKey) || 1;
    
    // Always notify for non-recoverable errors
    if (!errorInfo.type.recoverable) return true;
    
    // Notify if we've exhausted retry attempts
    if (count > errorInfo.type.maxRetries) return true;
    
    // Notify for critical contexts
    if (context.includes('critical') || context.includes('storage')) return true;
    
    // Don't spam user with frequent notifications
    return count === 1 || count % 5 === 0;
  }

  /**
   * Show user-friendly error notification
   * @param {Object} errorInfo 
   * @param {string} context 
   */
  async notifyUser(errorInfo, context) {
    const notification = {
      title: errorInfo.type.title,
      message: errorInfo.type.message,
      type: errorInfo.type.recoverable ? 'warning' : 'error',
      context,
      timestamp: Date.now()
    };

    this.userNotificationQueue.push(notification);
    
    if (!this.isProcessingNotifications) {
      await this.processNotificationQueue();
    }
  }

  /**
   * Process queued user notifications
   */
  async processNotificationQueue() {
    this.isProcessingNotifications = true;
    
    while (this.userNotificationQueue.length > 0) {
      const notification = this.userNotificationQueue.shift();
      
      try {
        // Try to show popup notification if available
        if (typeof window !== 'undefined' && document.querySelector('.container')) {
          this.showPopupNotification(notification);
        }
        // Fallback to console for background contexts
        else {
          console.warn(`[${notification.title}] ${notification.message}`);
        }
        
        // Space out notifications
        await this.delay(2000);
      } catch (error) {
        this.logger.warn('Failed to show user notification', error);
      }
    }
    
    this.isProcessingNotifications = false;
  }

  /**
   * Show notification in popup UI
   * @param {Object} notification 
   */
  showPopupNotification(notification) {
    const existingNotification = document.querySelector('.error-notification');
    if (existingNotification) {
      existingNotification.remove();
    }

    const notificationEl = document.createElement('div');
    notificationEl.className = `error-notification notification ${notification.type}`;
    notificationEl.innerHTML = `
      <div class="notification-header">
        <strong>${notification.title}</strong>
        <button class="close-notification" aria-label="Close">&times;</button>
      </div>
      <div class="notification-message">${notification.message}</div>
    `;

    const container = document.querySelector('.container');
    if (container) {
      container.insertBefore(notificationEl, container.firstChild);
      
      // Auto-remove after delay
      setTimeout(() => {
        notificationEl.classList.add('fade-out');
        setTimeout(() => {
          if (notificationEl.parentNode) {
            notificationEl.remove();
          }
        }, 300);
      }, 5000);

      // Manual close
      const closeBtn = notificationEl.querySelector('.close-notification');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          notificationEl.classList.add('fade-out');
          setTimeout(() => {
            if (notificationEl.parentNode) {
              notificationEl.remove();
            }
          }, 300);
        });
      }
    }
  }

  /**
   * Set up global error handlers
   */
  setupGlobalErrorHandlers() {
    // Handle unhandled promise rejections
    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', (event) => {
        this.handleError(event.reason, 'unhandled_promise_rejection', { 
          promise: event.promise 
        });
      });

      window.addEventListener('error', (event) => {
        this.handleError(event.error || event.message, 'global_error', {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        });
      });
    }

    // Handle Chrome extension API errors
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'ERROR_REPORT') {
          this.handleError(message.error, message.context, message.metadata);
        }
      });
    }
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  getErrorStats() {
    const stats = {
      totalErrors: 0,
      errorsByType: {},
      errorsByContext: {},
      mostFrequentErrors: []
    };

    for (const [key, count] of this.errorCounts.entries()) {
      stats.totalErrors += count;
      
      const [type, context] = key.split('_', 2);
      stats.errorsByType[type] = (stats.errorsByType[type] || 0) + count;
      stats.errorsByContext[context] = (stats.errorsByContext[context] || 0) + count;
    }

    stats.mostFrequentErrors = Array.from(this.errorCounts.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([key, count]) => ({ key, count }));

    return stats;
  }

  /**
   * Clear error statistics
   */
  clearErrorStats() {
    this.errorCounts.clear();
    this.logger.info('Error statistics cleared');
  }

  /**
   * Utility delay function
   * @param {number} ms 
   * @returns {Promise}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Report error to analytics (placeholder for future implementation)
   * @param {Object} errorInfo 
   */
  reportToAnalytics(errorInfo) {
    // Future implementation for error analytics
    this.logger.debug('Error reported to analytics', errorInfo);
  }
}

// Create global instance
const errorHandler = new ErrorHandler();

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ErrorHandler;
}

// Make available globally for debugging
if (typeof window !== 'undefined') {
  window.errorHandler = errorHandler;
}