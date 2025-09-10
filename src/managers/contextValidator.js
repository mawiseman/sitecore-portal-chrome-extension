/**
 * Context Validation Utility for Chrome Extension
 * Handles extension context invalidation and provides graceful degradation
 */

class ContextValidator {
  constructor() {
    this.isContextValid = true;
    this.logger = Logger.createContextLogger('ContextValidator');
    this.contextCheckInterval = null;
    this.setupContextMonitoring();
  }

  /**
   * Check if the extension context is still valid
   * @returns {boolean} True if context is valid, false otherwise
   */
  isExtensionContextValid() {
    try {
      // Try to access a basic Chrome API to test context validity
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        return false;
      }

      // Check if runtime is accessible
      const extensionId = chrome.runtime.id;
      if (!extensionId) {
        return false;
      }

      // Additional checks for content script context
      if (typeof window !== 'undefined' && window.location) {
        // We're in a content script, additional validation might be needed
        return true;
      }

      return true;
    } catch (error) {
      this.logger.debug('Context validation failed', error);
      return false;
    }
  }

  /**
   * Validate context before Chrome API operations
   * @param {string} operation - Description of the operation being attempted
   * @returns {Promise<boolean>} True if context is valid and operation can proceed
   */
  async validateContext(operation = 'Chrome API operation') {
    const isValid = this.isExtensionContextValid();
    
    if (!isValid) {
      this.isContextValid = false;
      this.logger.warn(`Extension context invalidated during: ${operation}`);
      
      // Try to handle the context invalidation gracefully
      await this.handleContextInvalidation(operation);
      return false;
    }

    this.isContextValid = true;
    return true;
  }

  /**
   * Handle context invalidation gracefully
   * @param {string} operation - The operation that failed
   */
  async handleContextInvalidation(operation) {
    this.logger.info('Handling extension context invalidation', { operation });

    // Stop any ongoing operations
    this.stopContextMonitoring();

    // Clear any timeouts or intervals
    this.clearPendingOperations();

    // Notify user if in popup context
    if (typeof document !== 'undefined' && document.querySelector('.container')) {
      this.showContextInvalidationNotification();
    }

    // Attempt to reinitialize if possible
    setTimeout(() => {
      this.attemptReinitialize();
    }, 1000);
  }

  /**
   * Attempt to reinitialize the extension context
   */
  attemptReinitialize() {
    this.logger.debug('Attempting to reinitialize extension context');
    
    if (this.isExtensionContextValid()) {
      this.logger.info('Extension context reinitialized successfully');
      this.isContextValid = true;
      this.setupContextMonitoring();
      
      // Trigger reinitialization event for other components
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('extensionContextReinitialized'));
      }
    } else {
      this.logger.debug('Context still invalid, will retry later');
      // Try again in a few seconds
      setTimeout(() => this.attemptReinitialize(), 5000);
    }
  }

  /**
   * Set up periodic context monitoring
   */
  setupContextMonitoring() {
    if (this.contextCheckInterval) {
      clearInterval(this.contextCheckInterval);
    }

    // Check context validity every 30 seconds
    this.contextCheckInterval = setInterval(() => {
      const wasValid = this.isContextValid;
      const isValid = this.isExtensionContextValid();
      
      if (wasValid && !isValid) {
        this.handleContextInvalidation('periodic_check');
      } else if (!wasValid && isValid) {
        this.logger.info('Extension context recovered');
        this.isContextValid = true;
      }
    }, 30000);
  }

  /**
   * Stop context monitoring
   */
  stopContextMonitoring() {
    if (this.contextCheckInterval) {
      clearInterval(this.contextCheckInterval);
      this.contextCheckInterval = null;
    }
  }

  /**
   * Clear any pending operations
   */
  clearPendingOperations() {
    // Clear any stored timeouts or intervals
    // This is a placeholder - specific implementations would clear their own timeouts
    this.logger.debug('Clearing pending operations due to context invalidation');
  }

  /**
   * Show notification about context invalidation in popup
   */
  showContextInvalidationNotification() {
    try {
      const container = document.querySelector('.container');
      if (!container) return;

      const notification = document.createElement('div');
      notification.className = 'error-notification warning';
      notification.innerHTML = `
        <div class="notification-header">
          <strong>Extension Reloaded</strong>
          <button class="close-notification" aria-label="Close">&times;</button>
        </div>
        <div class="notification-message">
          The extension was updated or reloaded. Please refresh the page or reopen the popup to continue.
        </div>
      `;

      container.insertBefore(notification, container.firstChild);

      // Auto-remove after longer delay since this is important
      setTimeout(() => {
        if (notification.parentNode) {
          notification.classList.add('fade-out');
          setTimeout(() => notification.remove(), 300);
        }
      }, 10000);

      // Manual close
      const closeBtn = notification.querySelector('.close-notification');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          notification.classList.add('fade-out');
          setTimeout(() => notification.remove(), 300);
        });
      }
    } catch (error) {
      this.logger.debug('Could not show context invalidation notification', error);
    }
  }

  /**
   * Wrapper for Chrome storage operations with context validation
   * @param {Function} operation - The storage operation to perform
   * @param {string} operationName - Name of the operation for logging
   * @returns {Promise<*>} Result of the operation or null if context is invalid
   */
  async safeStorageOperation(operation, operationName = 'storage operation') {
    const isValid = await this.validateContext(operationName);
    if (!isValid) {
      return null;
    }

    try {
      return await operation();
    } catch (error) {
      if (error.message && error.message.includes('Extension context invalidated')) {
        await this.handleContextInvalidation(operationName);
        return null;
      }
      throw error; // Re-throw non-context errors
    }
  }

  /**
   * Wrapper for Chrome runtime operations with context validation
   * @param {Function} operation - The runtime operation to perform
   * @param {string} operationName - Name of the operation for logging
   * @returns {Promise<*>} Result of the operation or null if context is invalid
   */
  async safeRuntimeOperation(operation, operationName = 'runtime operation') {
    const isValid = await this.validateContext(operationName);
    if (!isValid) {
      return null;
    }

    try {
      return await operation();
    } catch (error) {
      if (error.message && error.message.includes('Extension context invalidated')) {
        await this.handleContextInvalidation(operationName);
        return null;
      }
      throw error; // Re-throw non-context errors
    }
  }

  /**
   * Get current context status
   * @returns {Object} Context status information
   */
  getContextStatus() {
    return {
      isValid: this.isContextValid,
      runtimeAvailable: typeof chrome !== 'undefined' && !!chrome.runtime,
      runtimeId: this.isContextValid ? chrome.runtime?.id : null,
      monitoringActive: !!this.contextCheckInterval,
      timestamp: Date.now()
    };
  }

  /**
   * Cleanup method to be called when component is destroyed
   */
  cleanup() {
    this.stopContextMonitoring();
    this.clearPendingOperations();
    this.logger.debug('ContextValidator cleanup completed');
  }
}

// Create global instance
const contextValidator = new ContextValidator();

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContextValidator;
}

// Make available globally
if (typeof window !== 'undefined') {
  window.contextValidator = contextValidator;
}