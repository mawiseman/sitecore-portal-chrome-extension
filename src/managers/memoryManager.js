/**
 * Memory Management Utility for Chrome Extension
 * Prevents memory leaks by tracking and cleaning up observers and event listeners
 */

class MemoryManager {
  constructor() {
    // WeakMap to track event listeners for proper cleanup
    this.eventListeners = new WeakMap();
    
    // Set to track MutationObservers
    this.observers = new Set();
    
    // Timeout handlers for cleanup
    this.cleanupTimeouts = new Set();
    
    // Memory usage tracking
    this.memoryStats = {
      observersCreated: 0,
      observersDestroyed: 0,
      listenersAdded: 0,
      listenersRemoved: 0,
      cleanupOperations: 0
    };
    
    this.setupGlobalCleanup();
  }
  
  /**
   * Register a MutationObserver for tracking
   * @param {MutationObserver} observer 
   * @param {number} timeoutMs - Auto-cleanup timeout in milliseconds
   */
  registerObserver(observer, timeoutMs = 300000) { // 5 minutes default
    this.observers.add(observer);
    this.memoryStats.observersCreated++;
    
    // Set up timeout-based cleanup
    if (timeoutMs > 0) {
      const timeoutId = setTimeout(() => {
        this.disconnectObserver(observer);
        Logger.info('Observer auto-disconnected due to timeout', null, 'MemoryManager');
      }, timeoutMs);
      
      this.cleanupTimeouts.add(timeoutId);
    }
    
    Logger.debug('Observer registered', { 
      totalObservers: this.observers.size,
      timeoutMs 
    }, 'MemoryManager');
  }
  
  /**
   * Disconnect and remove an observer
   * @param {MutationObserver} observer 
   */
  disconnectObserver(observer) {
    if (this.observers.has(observer)) {
      observer.disconnect();
      this.observers.delete(observer);
      this.memoryStats.observersDestroyed++;
      Logger.debug('Observer disconnected', { 
        remainingObservers: this.observers.size 
      }, 'MemoryManager');
    }
  }
  
  /**
   * Add event listener with tracking
   * @param {Element|Window|Document} element 
   * @param {string} event 
   * @param {Function} handler 
   * @param {Object|Boolean} options 
   */
  addEventListener(element, event, handler, options = false) {
    element.addEventListener(event, handler, options);
    
    // Track the listener for cleanup
    if (!this.eventListeners.has(element)) {
      this.eventListeners.set(element, new Map());
    }
    
    const elementListeners = this.eventListeners.get(element);
    if (!elementListeners.has(event)) {
      elementListeners.set(event, new Set());
    }
    
    elementListeners.get(event).add({ handler, options });
    this.memoryStats.listenersAdded++;
    
    Logger.debug('Event listener added', { 
      event, 
      totalListeners: this.memoryStats.listenersAdded - this.memoryStats.listenersRemoved 
    }, 'MemoryManager');
  }
  
  /**
   * Remove event listener with tracking
   * @param {Element|Window|Document} element 
   * @param {string} event 
   * @param {Function} handler 
   * @param {Object|Boolean} options 
   */
  removeEventListener(element, event, handler, options = false) {
    element.removeEventListener(event, handler, options);
    
    const elementListeners = this.eventListeners.get(element);
    if (elementListeners && elementListeners.has(event)) {
      const eventSet = elementListeners.get(event);
      // Find and remove the matching handler
      for (const listenerObj of eventSet) {
        if (listenerObj.handler === handler) {
          eventSet.delete(listenerObj);
          this.memoryStats.listenersRemoved++;
          break;
        }
      }
      
      // Clean up empty collections
      if (eventSet.size === 0) {
        elementListeners.delete(event);
      }
      if (elementListeners.size === 0) {
        this.eventListeners.delete(element);
      }
    }
    
    Logger.debug('Event listener removed', { 
      event, 
      totalListeners: this.memoryStats.listenersAdded - this.memoryStats.listenersRemoved 
    }, 'MemoryManager');
  }
  
  /**
   * Remove all event listeners from an element
   * @param {Element|Window|Document} element 
   */
  removeAllEventListeners(element) {
    const elementListeners = this.eventListeners.get(element);
    if (!elementListeners) return;
    
    for (const [event, listenersSet] of elementListeners) {
      for (const listenerObj of listenersSet) {
        element.removeEventListener(event, listenerObj.handler, listenerObj.options);
        this.memoryStats.listenersRemoved++;
      }
    }
    
    this.eventListeners.delete(element);
    Logger.debug('All event listeners removed from element', { 
      totalListeners: this.memoryStats.listenersAdded - this.memoryStats.listenersRemoved 
    }, 'MemoryManager');
  }
  
  /**
   * Perform complete cleanup of all tracked resources
   */
  cleanup() {
    this.memoryStats.cleanupOperations++;
    
    // Disconnect all observers
    for (const observer of this.observers) {
      observer.disconnect();
    }
    this.memoryStats.observersDestroyed += this.observers.size;
    this.observers.clear();
    
    // Clear all timeouts
    for (const timeoutId of this.cleanupTimeouts) {
      clearTimeout(timeoutId);
    }
    this.cleanupTimeouts.clear();
    
    Logger.info('Complete cleanup performed', this.getMemoryStats(), 'MemoryManager');
  }
  
  /**
   * Set up global cleanup handlers
   */
  setupGlobalCleanup() {
    // Content script cleanup
    if (typeof window !== 'undefined') {
      this.addEventListener(window, 'beforeunload', () => {
        this.cleanup();
      });
      
      // Also handle page visibility changes
      this.addEventListener(document, 'visibilitychange', () => {
        if (document.hidden) {
          // Perform partial cleanup when page becomes hidden
          this.performPartialCleanup();
        }
      });
    }
    
    // Extension context cleanup
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      // Handle extension shutdown
      try {
        chrome.runtime.onSuspend.addListener(() => {
          this.cleanup();
        });
      } catch (error) {
        // Ignore if not in background context
      }
    }
  }
  
  /**
   * Perform partial cleanup for non-critical resources
   */
  performPartialCleanup() {
    // Clear old timeouts
    let clearedTimeouts = 0;
    for (const timeoutId of this.cleanupTimeouts) {
      clearTimeout(timeoutId);
      clearedTimeouts++;
    }
    this.cleanupTimeouts.clear();
    
    Logger.debug('Partial cleanup performed', { 
      clearedTimeouts,
      remainingObservers: this.observers.size 
    }, 'MemoryManager');
  }
  
  /**
   * Get current memory statistics
   * @returns {Object} Memory usage statistics
   */
  getMemoryStats() {
    return {
      ...this.memoryStats,
      activeObservers: this.observers.size,
      activeTimeouts: this.cleanupTimeouts.size,
      netListeners: this.memoryStats.listenersAdded - this.memoryStats.listenersRemoved
    };
  }
  
  /**
   * Monitor memory usage (if available)
   * @returns {Object|null} Memory usage information
   */
  getMemoryUsage() {
    if (typeof performance !== 'undefined' && performance.memory) {
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        timestamp: Date.now()
      };
    }
    return null;
  }
  
  /**
   * Log memory statistics
   */
  logMemoryStats() {
    const stats = this.getMemoryStats();
    const memoryUsage = this.getMemoryUsage();
    
    Logger.info('Memory Manager Statistics', { 
      stats, 
      memoryUsage 
    }, 'MemoryManager');
  }
}

// Create global instance
const memoryManager = new MemoryManager();

// Make it available globally for debugging
if (typeof window !== 'undefined') {
  window.memoryManager = memoryManager;
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MemoryManager;
}