/**
 * Async Utilities for Chrome Extension
 * Standardized Promise handling, timeout management, and error handling
 */

/**
 * Global async utilities class
 */
class AsyncUtils {
  /**
   * Wraps a Promise with timeout handling
   * @param {Promise} promise - Promise to wrap
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {string} operationName - Name for error reporting
   * @returns {Promise} Wrapped promise with timeout
   */
  static withTimeout(promise, timeoutMs, operationName = 'operation') {
    if (timeoutMs <= 0) {
      return promise;
    }

    const timeoutPromise = new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      
      // Clear timeout when original promise resolves/rejects
      promise.finally?.(() => clearTimeout(timeoutId));
    });
    
    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Wraps a Promise with retry logic
   * @param {Function} promiseFactory - Function that returns a Promise
   * @param {Object} options - Retry options
   * @returns {Promise} Promise with retry logic
   */
  static async withRetry(promiseFactory, options = {}) {
    const {
      maxRetries = 3,
      delayMs = 1000,
      backoffMultiplier = 2,
      shouldRetry = (error) => true
    } = options;

    let lastError;
    let delay = delayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await promiseFactory();
        return result;
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries || !shouldRetry(error)) {
          break;
        }
        
        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= backoffMultiplier;
      }
    }
    
    throw lastError;
  }

  /**
   * Converts Chrome API callback to Promise
   * @param {Function} chromeApiMethod - Chrome API method
   * @param {...any} args - Arguments to pass to the method
   * @returns {Promise} Promisified Chrome API call
   */
  static chromeApiPromise(chromeApiMethod, ...args) {
    return new Promise((resolve, reject) => {
      chromeApiMethod(...args, (...results) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          // Handle different result patterns
          if (results.length === 0) {
            resolve(undefined);
          } else if (results.length === 1) {
            resolve(results[0]);
          } else {
            resolve(results);
          }
        }
      });
    });
  }

  /**
   * Debounces an async function
   * @param {Function} asyncFn - Async function to debounce
   * @param {number} delayMs - Debounce delay in milliseconds
   * @returns {Function} Debounced async function
   */
  static debounceAsync(asyncFn, delayMs) {
    let timeoutId;
    let lastPromise;
    
    return function(...args) {
      return new Promise((resolve, reject) => {
        clearTimeout(timeoutId);
        
        timeoutId = setTimeout(async () => {
          try {
            lastPromise = asyncFn.apply(this, args);
            const result = await lastPromise;
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }, delayMs);
      });
    };
  }

  /**
   * Throttles an async function
   * @param {Function} asyncFn - Async function to throttle
   * @param {number} delayMs - Throttle delay in milliseconds
   * @returns {Function} Throttled async function
   */
  static throttleAsync(asyncFn, delayMs) {
    let isThrottled = false;
    let lastArgs;
    let lastThis;
    
    return async function(...args) {
      if (isThrottled) {
        lastArgs = args;
        lastThis = this;
        return;
      }
      
      isThrottled = true;
      
      try {
        const result = await asyncFn.apply(this, args);
        
        setTimeout(() => {
          isThrottled = false;
          if (lastArgs) {
            const argsToProcess = lastArgs;
            const thisToProcess = lastThis;
            lastArgs = null;
            lastThis = null;
            asyncFn.apply(thisToProcess, argsToProcess);
          }
        }, delayMs);
        
        return result;
      } catch (error) {
        isThrottled = false;
        throw error;
      }
    };
  }

  /**
   * Creates a Promise that resolves after specified delay
   * @param {number} ms - Delay in milliseconds
   * @returns {Promise} Promise that resolves after delay
   */
  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Handles Promise rejections globally
   * @param {Promise} promise - Promise to handle
   * @param {string} context - Context for error reporting
   * @param {Function} fallback - Optional fallback function
   * @returns {Promise} Handled promise
   */
  static async handlePromiseRejection(promise, context = 'unknown', fallback = null) {
    try {
      const result = await promise;
      return result;
    } catch (error) {
      // Enhanced error context
      const errorDetails = {
        message: error?.message || 'Unknown error',
        code: error?.code,
        name: error?.name || error?.constructor?.name,
        context: context,
        timestamp: new Date().toISOString()
      };
      
      // Log the error with context - include original error for stack trace
      if (typeof Logger !== 'undefined') {
        Logger.error(`Promise rejection in ${context}: ${errorDetails.message}`, error);
      } else {
        console.error(`[AsyncUtils] Promise rejection in ${context}:`, errorDetails, error);
      }
      
      // Use error handler if available
      if (typeof errorHandler !== 'undefined') {
        const recovered = await errorHandler.handleError(error, `promise_rejection_${context}`, {
          ...errorDetails,
          originalError: error
        }, fallback);
        
        if (recovered && fallback) {
          return await fallback(error);
        }
      }
      
      // Re-throw if no recovery
      throw error;
    }
  }

  /**
   * Safely executes an async function with full error handling
   * @param {Function} asyncFn - Async function to execute
   * @param {Object} options - Execution options
   * @returns {Promise} Safely executed function result
   */
  static async safeExecute(asyncFn, options = {}) {
    const {
      timeout = 0,
      retries = 0,
      context = 'safe_execute',
      fallback = null,
      onError = null
    } = options;

    try {
      let result;
      
      // Apply wrappers based on options
      if (retries > 0 && timeout > 0) {
        // Both retry and timeout
        result = await this.withRetry(
          () => this.withTimeout(asyncFn(), timeout, context),
          { maxRetries: retries }
        );
      } else if (retries > 0) {
        // Only retry
        result = await this.withRetry(asyncFn, { maxRetries: retries });
      } else if (timeout > 0) {
        // Only timeout
        result = await this.withTimeout(asyncFn(), timeout, context);
      } else {
        // No wrappers
        result = await asyncFn();
      }
      
      return result;
      
    } catch (error) {
      if (onError) {
        await onError(error);
      }
      
      // Handle the error directly, don't create a new rejected promise
      // Enhanced error context
      const errorDetails = {
        message: error?.message || 'Unknown error',
        code: error?.code,
        name: error?.name || error?.constructor?.name,
        context: context,
        timestamp: new Date().toISOString()
      };
      
      // Log the error with context
      if (typeof Logger !== 'undefined') {
        Logger.error(`Error in ${context}: ${errorDetails.message}`, error);
      } else {
        console.error(`[AsyncUtils] Error in ${context}:`, errorDetails, error);
      }
      
      // Use error handler if available
      if (typeof errorHandler !== 'undefined') {
        // Don't pass the fallback to errorHandler to avoid double execution
        const recovered = await errorHandler.handleError(error, `async_${context}`, {
          ...errorDetails
          // Removed originalError to avoid circular references
        }, null);
        
        // If error handler didn't recover, try the fallback
        if (!recovered && fallback) {
          try {
            return typeof fallback === 'function' ? await fallback(error) : fallback;
          } catch (fallbackError) {
            // If fallback also fails, log it but don't recurse
            if (typeof Logger !== 'undefined') {
              Logger.warn(`Fallback failed in ${context}:`, fallbackError.message);
            }
            throw error; // Throw original error, not fallback error
          }
        }
        
        if (recovered) {
          return null; // Recovery successful, return null
        }
      } else if (fallback) {
        // No error handler available, use fallback directly
        try {
          return typeof fallback === 'function' ? await fallback(error) : fallback;
        } catch (fallbackError) {
          // If fallback fails, log it but don't recurse
          if (typeof Logger !== 'undefined') {
            Logger.warn(`Fallback failed in ${context}:`, fallbackError.message);
          }
          throw error; // Throw original error
        }
      }
      
      // Re-throw if no recovery
      throw error;
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.AsyncUtils = AsyncUtils;
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AsyncUtils;
}