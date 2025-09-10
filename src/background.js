// Service worker background script
console.log('Loading background script...');

// Try to import logger, fallback if needed
let logger;
try {
  importScripts('logger.js');
  logger = Logger.createContextLogger('Background');
} catch (e) {
  console.warn('Could not load logger, using console fallback:', e);
  logger = {
    info: (...args) => console.log('[Background]', ...args),
    error: (...args) => console.error('[Background]', ...args),
    debug: (...args) => console.log('[Background-Debug]', ...args),
    warn: (...args) => console.warn('[Background]', ...args)
  };
}

// Simple config for background script - avoid redeclaration
const backgroundConfig = {
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

// Use backgroundConfig as CONFIG for this context
const CONFIG = backgroundConfig;

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

// Store request/response pairs to match them up
const pendingRequests = new Map();

// Listen for GET requests to the organizations endpoint with proper async handling
chrome.webRequest.onBeforeRequest.addListener(
  async function(details) {
    try {
      logger.debug('Organizations GET request intercepted', {
        method: details.method,
        url: details.url,
        tabId: details.tabId
      });

      // Register request with lifecycle manager
      const request = requestLifecycleManager.registerRequest(details.requestId, {
        type: 'organizations',
        url: details.url,
        tabId: details.tabId
      });

      // Store this request to match with the response
      pendingRequests.set(details.requestId, {
        tabId: details.tabId,
        url: details.url,
        type: 'organizations',
        timestamp: Date.now(),
        lifecycleId: request.id
      });
    } catch (error) {
      await errorHandler.handleError(error, 'organizations_request_intercepted', {
        requestId: details.requestId,
        url: details.url
      });
    }
  },
  {
    urls: [typeof CONFIG !== 'undefined' ? `${CONFIG.get('API.SITECORE_IDENTITY_BASE')}${CONFIG.get('API.ORGANIZATIONS_ENDPOINT')}*` : "https://identity.sitecorecloud.io/api/identity/v1/user/organizations*"]
  }
);

// Listen for requests to the GraphQL endpoint with proper async handling
chrome.webRequest.onBeforeRequest.addListener(
  async function(details) {
    try {
      logger.debug('Request intercepted', {
        method: details.method,
        url: details.url,
        tabId: details.tabId
      });

      // Check if this is a POST request to the GraphQL endpoint
      if (details.method === 'POST' && 
          details.url.includes('/api/portal/graphql')) {
        
        logger.debug('GraphQL POST request detected');
        
        // Try to read the request body
        if (details.requestBody && details.requestBody.raw) {
          try {
            const decoder = new TextDecoder('utf-8');
            let bodyContent = '';
            
            for (const buffer of details.requestBody.raw) {
              bodyContent += decoder.decode(buffer.bytes);
            }
            
            logger.debug('Request body', {
              length: bodyContent.length,
              preview: bodyContent.substring(0, 200)
            });
            
            // Check if this is a tenants query
            const isTenantsQuery = bodyContent.includes('GetTenants') || 
                                 bodyContent.includes('applications') ||
                                 bodyContent.includes('user');
            
            if (isTenantsQuery) {
              logger.info('Tenants query detected! Storing request for response matching');
              
              // Register request with lifecycle manager
              const request = requestLifecycleManager.registerRequest(details.requestId, {
                type: 'tenants',
                url: details.url,
                tabId: details.tabId
              });
              
              // Store this request to match with the response
              pendingRequests.set(details.requestId, {
                tabId: details.tabId,
                url: details.url,
                body: bodyContent,
                timestamp: Date.now(),
                lifecycleId: request.id
              });
            }
            
          } catch (error) {
            await errorHandler.handleError(error, 'read_request_body', {
              requestId: details.requestId,
              url: details.url
            });
          }
        }
      }
    } catch (error) {
      await errorHandler.handleError(error, 'graphql_request_intercepted', {
        requestId: details.requestId,
        url: details.url
      });
    }
  },
  {
    urls: [typeof CONFIG !== 'undefined' ? `${CONFIG.get('API.SITECORE_PORTAL_BASE')}${CONFIG.get('API.TENANTS_ENDPOINT')}*` : "https://portal.sitecorecloud.io/api/portal/graphql*"]
  },
  ["requestBody"]
);

// Listen for responses with proper async error handling
chrome.webRequest.onResponseStarted.addListener(
  async function(details) {
    try {
      // Check if we have a matching request
      const request = pendingRequests.get(details.requestId);
      
      if (request) {
        // Update request lifecycle status
        if (request.lifecycleId) {
          requestLifecycleManager.updateRequestStatus(request.lifecycleId, 'completed');
        }
        
        if (request.type === 'organizations') {
          logger.debug('Response received for organizations query', {
            statusCode: details.statusCode,
            tabId: details.tabId
          });
          
          // Send message to content script to capture organizations data
          const sent = await safeSendMessage(details.tabId, {
            type: 'ORGANIZATIONS_RESPONSE_DETECTED',
            requestId: details.requestId,
            url: details.url,
            statusCode: details.statusCode
          });
          
          if (!sent) {
            logger.debug('Could not notify content script about organizations response', {
              tabId: details.tabId,
              requestId: details.requestId
            });
          }
        } else {
          logger.debug('Response received for tenants query', {
            statusCode: details.statusCode,
            tabId: details.tabId
          });
          
          // Send message to content script to capture tenants data
          const sent = await safeSendMessage(details.tabId, {
            type: 'TENANTS_RESPONSE_DETECTED',
            requestId: details.requestId,
            url: details.url,
            statusCode: details.statusCode
          });
          
          if (!sent) {
            logger.debug('Could not notify content script about tenants response', {
              tabId: details.tabId,
              requestId: details.requestId
            });
          }
        }
        
        // Clean up
        pendingRequests.delete(details.requestId);
      }
    } catch (error) {
      await errorHandler.handleError(error, 'response_handler', {
        requestId: details.requestId,
        statusCode: details.statusCode
      });
    }
  },
  {
    urls: [
      typeof CONFIG !== 'undefined' ? `${CONFIG.get('API.SITECORE_PORTAL_BASE')}${CONFIG.get('API.TENANTS_ENDPOINT')}*` : "https://portal.sitecorecloud.io/api/portal/graphql*",
      typeof CONFIG !== 'undefined' ? `${CONFIG.get('API.SITECORE_IDENTITY_BASE')}${CONFIG.get('API.ORGANIZATIONS_ENDPOINT')}*` : "https://identity.sitecorecloud.io/api/identity/v1/user/organizations*"
    ]
  }
);

// Clean up old pending requests periodically - now with race condition protection
setInterval(() => {
  // Use lifecycle manager's safe cleanup
  if (!requestLifecycleManager.hasActiveRequests() || Date.now() % 120000 < 30000) { // Only cleanup every 2 minutes or when no active requests
    requestLifecycleManager.performSafeCleanup();
    
    // Legacy cleanup for backward compatibility
    const now = Date.now();
    const timeout = typeof CONFIG !== 'undefined' ? CONFIG.get('TIMEOUTS.STORAGE_CLEANUP') : 60000;
    
    for (const [requestId, request] of pendingRequests.entries()) {
      if (now - request.timestamp > timeout) {
        logger.debug('Cleaning up legacy pending request', { requestId, age: now - request.timestamp });
        pendingRequests.delete(requestId);
      }
    }
  } else {
    logger.debug('Skipping cleanup - active requests in progress');
  }
}, typeof CONFIG !== 'undefined' ? CONFIG.get('TIMEOUTS.STORAGE_CLEANUP') / 2 : 30000);

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

logger.info('Background script: WebRequest listeners registered');