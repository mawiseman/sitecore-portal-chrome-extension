// Service worker background script
console.log('Loading background script...');

// Import required scripts for service worker
try {
  importScripts(
    '../config/config.js',
    '../utils/logger.js',
    '../utils/storageSecurityManager.js',
    '../managers/optimizedRequestInterceptor.js'
  );
} catch (e) {
  console.error('Failed to import required scripts:', e);
}

// Try to create logger with fallback
let logger;
try {
  logger = typeof Logger !== 'undefined' ? Logger.createContextLogger('Background') : null;
} catch (e) {
  console.warn('Could not create logger, using fallback');
}

if (!logger) {
  logger = {
    info: (...args) => console.log('[Background]', ...args),
    error: (...args) => console.error('[Background]', ...args),
    debug: (...args) => console.log('[Background-Debug]', ...args),
    warn: (...args) => console.warn('[Background]', ...args)
  };
}

// Use existing CONFIG if available, otherwise create fallback
if (typeof CONFIG === 'undefined') {
  var CONFIG = {
    get: (path, defaultValue) => {
      const configs = {
        'TIMEOUTS.STORAGE_CLEANUP': 60000,
        'API.SITECORE_IDENTITY_BASE': 'https://identity.sitecorecloud.io',
        'API.SITECORE_PORTAL_BASE': 'https://portal.sitecorecloud.io', 
        'API.ORGANIZATIONS_ENDPOINT': '/api/identity/v1/user/organizations',
        'API.TENANTS_ENDPOINT': '/api/portal/graphql'
      };
      return configs[path] || defaultValue;
    }
  };
}

// Simple error handler for background script - avoid redeclaration
const backgroundErrorHandler = {
  handleError: (error, context, metadata = {}, callback = null) => {
    // Format error properly for logging
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    const errorDetails = {
      message: errorMessage,
      stack: error?.stack,
      metadata
    };
    logger.error(`Error in ${context}: ${errorMessage}`, errorDetails);
    if (callback) {
      try {
        callback();
      } catch (e) {
        const callbackError = e?.message || e?.toString() || 'Unknown error';
        logger.error(`Recovery callback failed: ${callbackError}`, e);
      }
    }
    return Promise.resolve(false);
  }
};

// Use backgroundErrorHandler as errorHandler for this context
const errorHandler = backgroundErrorHandler;

// Helper function to safely send messages to tabs
async function safeSendMessage(tabId, message) {
  try {
    // First check if the tab exists and is ready
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      logger.warn(`Tab ${tabId} not found, skipping message`);
      return false;
    }
    
    // Check if tab URL is valid for content script
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      logger.debug(`Tab ${tabId} has restricted URL, skipping message`);
      return false;
    }
    
    // Try to send the message
    const response = await chrome.tabs.sendMessage(tabId, message).catch(err => {
      // If content script is not ready, log it as debug instead of error
      if (err.message?.includes('Receiving end does not exist')) {
        logger.debug(`Content script not ready in tab ${tabId}, message skipped`);
        return null;
      }
      throw err; // Re-throw other errors
    });
    
    return response !== null;
  } catch (error) {
    logger.warn(`Failed to send message to tab ${tabId}:`, { 
      error: error.message,
      messageType: message.type 
    });
    return false;
  }
}

// Import request lifecycle manager (inline for service worker)
// Since we can't import modules directly in service worker, we'll create a simplified version
class SimpleRequestLifecycleManager {
  constructor() {
    this.activeRequests = new Map();
    this.requestSequence = 0;
  }

  registerRequest(requestId, requestInfo) {
    const request = {
      id: requestId,
      sequence: ++this.requestSequence,
      timestamp: Date.now(),
      status: 'pending',
      type: requestInfo.type,
      url: requestInfo.url,
      tabId: requestInfo.tabId
    };

    this.activeRequests.set(requestId, request);
    logger.debug('Request registered', { requestId, type: request.type });
    return request;
  }

  updateRequestStatus(requestId, status) {
    const request = this.activeRequests.get(requestId);
    if (request) {
      request.status = status;
      request.lastUpdated = Date.now();
      
      if (['completed', 'failed', 'timeout', 'cancelled'].includes(status)) {
        // Move to history and cleanup
        setTimeout(() => this.activeRequests.delete(requestId), 5000);
      }
    }
  }

  hasActiveRequests() {
    return this.activeRequests.size > 0;
  }

  performSafeCleanup() {
    const now = Date.now();
    const staleThreshold = 120000; // 2 minutes

    for (const [requestId, request] of this.activeRequests.entries()) {
      if (now - request.timestamp > staleThreshold) {
        logger.warn('Cleaning up stale request', { requestId, age: now - request.timestamp });
        this.activeRequests.delete(requestId);
      }
    }
  }
}

// Initialize request lifecycle manager
const requestLifecycleManager = new SimpleRequestLifecycleManager();

logger.info('Sitecore Portal extension background script loaded');

// Initialize optimized request interceptor (replaces multiple old listeners)
let optimizedInterceptor = null;
try {
  optimizedInterceptor = getOptimizedRequestInterceptor();
  optimizedInterceptor.initialize();
  logger.info('Optimized request interceptor initialized successfully');
} catch (error) {
  logger.error('Failed to initialize optimized request interceptor', error);
  // Fallback to legacy behavior if needed
}

// Legacy request listeners removed - replaced by OptimizedRequestInterceptor
// The optimized interceptor handles all request/response interception with:
// - Deduplication logic to prevent duplicate processing
// - Single consolidated listener for better performance  
// - Optimized pattern matching with compiled regex
// - Memory management and cleanup

// Legacy response listener and cleanup interval removed - 
// OptimizedRequestInterceptor handles all response processing and cleanup internally

// Global unhandled Promise rejection handler for service worker
self.addEventListener('unhandledrejection', async (event) => {
  logger.error('Unhandled Promise rejection in background script:', event.reason);
  
  if (typeof errorHandler !== 'undefined') {
    event.preventDefault();
    await errorHandler.handleError(event.reason, 'unhandled_promise_rejection', {
      context: 'background_script',
      promiseRejection: true
    });
  }
});

// Extension uninstall handler for secure data deletion
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    logger.info('Extension installed - initializing security features');
    
    // Schedule periodic cleanup of expired data
    chrome.alarms.create('cleanup-expired-data', {
      delayInMinutes: 60,
      periodInMinutes: 60
    });
  }
});

// Handle alarms for cleanup
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'cleanup-expired-data') {
    logger.debug('Running scheduled cleanup of expired data');
    
    try {
      // Initialize storage security manager if available
      if (typeof StorageSecurityManager !== 'undefined') {
        const securityManager = new StorageSecurityManager();
        await securityManager.cleanupExpiredData();
      } else {
        logger.warn('StorageSecurityManager not available for cleanup');
      }
    } catch (error) {
      logger.error('Failed to run scheduled cleanup', error);
    }
  }
});

// Extension uninstall preparation (when possible)
// Note: Chrome doesn't provide a direct uninstall event, but we can handle management events
if (chrome.management && chrome.management.onUninstalled) {
  chrome.management.onUninstalled.addListener(async (extensionInfo) => {
    if (extensionInfo.id === chrome.runtime.id) {
      logger.info('Extension being uninstalled - performing secure cleanup');
      
      try {
        // Initialize storage security manager if available
        if (typeof StorageSecurityManager !== 'undefined') {
          const securityManager = new StorageSecurityManager();
          await securityManager.secureDelete();
          logger.info('Secure deletion completed on uninstall');
        } else {
          logger.warn('StorageSecurityManager not available for secure deletion');
        }
      } catch (error) {
        logger.error('Failed to perform secure deletion on uninstall', error);
      }
    }
  });
}

logger.info('Background script: WebRequest listeners registered');