/**
 * Optimized Request Interceptor
 * Consolidates all request interception into a single, efficient background-only system
 * Eliminates redundant injection scripts and adds deduplication
 */

class OptimizedRequestInterceptor {
  constructor() {
    this.logger = typeof Logger !== 'undefined' 
      ? Logger.createContextLogger('OptimizedRequestInterceptor') 
      : this.createFallbackLogger();
    
    // Request tracking and deduplication
    this.activeRequests = new Map(); // requestId -> request info
    this.recentRequests = new Map(); // hash -> timestamp for deduplication
    this.requestSequence = 0;
    
    // Configuration
    this.config = typeof CONFIG !== 'undefined' ? CONFIG : this.createFallbackConfig();
    
    // Performance metrics
    this.metrics = {
      requestsIntercepted: 0,
      requestsDeduped: 0,
      organizationsProcessed: 0,
      tenantsProcessed: 0,
      errors: 0,
      startTime: Date.now()
    };
    
    // Request patterns - optimized for performance
    this.patterns = this.compileRequestPatterns();
    
    // Deduplication settings
    this.DEDUP_WINDOW_MS = 5000; // 5 second window for dedup
    this.CLEANUP_INTERVAL_MS = 30000; // Clean up old requests every 30s
    
    this.logger.info('OptimizedRequestInterceptor initialized');
    this.startCleanupInterval();
  }
  
  /**
   * Create fallback logger if main logger not available
   */
  createFallbackLogger() {
    return {
      debug: (...args) => console.debug('[OptimizedInterceptor]', ...args),
      info: (...args) => console.info('[OptimizedInterceptor]', ...args),
      warn: (...args) => console.warn('[OptimizedInterceptor]', ...args),
      error: (...args) => console.error('[OptimizedInterceptor]', ...args)
    };
  }
  
  /**
   * Create fallback config if main config not available
   */
  createFallbackConfig() {
    return {
      get: (path, defaultValue) => {
        const defaults = {
          'API.SITECORE_IDENTITY_BASE': 'https://identity.sitecorecloud.io',
          'API.SITECORE_PORTAL_BASE': 'https://portal.sitecorecloud.io',
          'API.ORGANIZATIONS_ENDPOINT': '/api/identity/v1/user/organizations',
          'API.TENANTS_ENDPOINT': '/api/portal/graphql'
        };
        return defaults[path] || defaultValue;
      }
    };
  }
  
  /**
   * Compile and optimize request patterns for fast matching
   */
  compileRequestPatterns() {
    const baseUrls = {
      identity: this.config.get('API.SITECORE_IDENTITY_BASE'),
      portal: this.config.get('API.SITECORE_PORTAL_BASE')
    };
    
    return {
      organizations: {
        pattern: `${baseUrls.identity}${this.config.get('API.ORGANIZATIONS_ENDPOINT')}`,
        regex: new RegExp(`${baseUrls.identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/identity/v1/user/organizations`),
        type: 'organizations'
      },
      graphql: {
        pattern: `${baseUrls.portal}${this.config.get('API.TENANTS_ENDPOINT')}`,
        regex: new RegExp(`${baseUrls.portal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/portal/graphql`),
        type: 'graphql'
      }
    };
  }
  
  /**
   * Fast request type detection using compiled patterns
   */
  detectRequestType(url) {
    // Use regex for fast matching instead of includes()
    if (this.patterns.organizations.regex.test(url)) {
      return this.patterns.organizations.type;
    }
    if (this.patterns.graphql.regex.test(url)) {
      return this.patterns.graphql.type;
    }
    return null;
  }
  
  /**
   * Generate hash for request deduplication
   */
  generateRequestHash(url, method = 'GET', body = null) {
    let hashInput = `${method}:${url}`;
    if (body && method === 'POST') {
      // For GraphQL, include query in hash to dedupe identical queries
      hashInput += `:${typeof body === 'string' ? body : JSON.stringify(body)}`;
    }
    
    // Simple hash function - fast but sufficient for deduplication
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }
  
  /**
   * Check if request should be deduplicated
   */
  shouldDeduplicateRequest(hash) {
    const now = Date.now();
    const lastSeen = this.recentRequests.get(hash);
    
    if (lastSeen && (now - lastSeen) < this.DEDUP_WINDOW_MS) {
      this.metrics.requestsDeduped++;
      return true;
    }
    
    this.recentRequests.set(hash, now);
    return false;
  }
  
  /**
   * Start the cleanup interval for memory management
   */
  startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldRequests();
    }, this.CLEANUP_INTERVAL_MS);
  }
  
  /**
   * Clean up old requests to prevent memory leaks
   */
  cleanupOldRequests() {
    const now = Date.now();
    const cutoff = now - (this.DEDUP_WINDOW_MS * 2); // Keep 2x the dedup window
    
    // Clean up recent requests map
    let cleanedRecent = 0;
    for (const [hash, timestamp] of this.recentRequests.entries()) {
      if (timestamp < cutoff) {
        this.recentRequests.delete(hash);
        cleanedRecent++;
      }
    }
    
    // Clean up active requests that are too old
    let cleanedActive = 0;
    for (const [requestId, request] of this.activeRequests.entries()) {
      if (request.timestamp < cutoff) {
        this.activeRequests.delete(requestId);
        cleanedActive++;
      }
    }
    
    if (cleanedRecent > 0 || cleanedActive > 0) {
      this.logger.debug('Cleaned up old requests', { 
        recentRequests: cleanedRecent, 
        activeRequests: cleanedActive 
      });
    }
  }
  
  /**
   * Initialize the optimized interception system
   */
  initialize() {
    this.logger.info('Setting up optimized request interception...');
    
    // Register optimized webRequest listeners
    this.setupWebRequestInterception();
    
    this.logger.info('Optimized request interception active');
  }
  
  /**
   * Set up optimized webRequest interception
   */
  setupWebRequestInterception() {
    // Single listener for all requests - more efficient
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => this.handleRequest(details),
      {
        urls: [
          `${this.patterns.organizations.pattern}*`,
          `${this.patterns.graphql.pattern}*`
        ]
      },
      ['requestBody']
    );
    
    // Response listener for processing data
    chrome.webRequest.onResponseStarted.addListener(
      (details) => this.handleResponse(details),
      {
        urls: [
          `${this.patterns.organizations.pattern}*`,
          `${this.patterns.graphql.pattern}*`
        ]
      }
    );
    
    this.logger.debug('WebRequest listeners registered', { 
      patterns: Object.keys(this.patterns)
    });
  }
  
  /**
   * Handle incoming requests with deduplication
   */
  async handleRequest(details) {
    try {
      this.metrics.requestsIntercepted++;
      
      const requestType = this.detectRequestType(details.url);
      if (!requestType) {
        return; // Not a request we care about
      }
      
      // Generate hash for deduplication
      const requestBody = details.requestBody?.raw?.[0]?.bytes 
        ? new TextDecoder().decode(details.requestBody.raw[0].bytes)
        : null;
      
      const hash = this.generateRequestHash(details.url, details.method, requestBody);
      
      // Check for deduplication
      if (this.shouldDeduplicateRequest(hash)) {
        this.logger.debug('Request deduplicated', { 
          url: details.url, 
          hash, 
          type: requestType 
        });
        return;
      }
      
      // Store request info
      const requestInfo = {
        id: details.requestId,
        type: requestType,
        url: details.url,
        method: details.method,
        tabId: details.tabId,
        hash,
        timestamp: Date.now(),
        sequence: ++this.requestSequence,
        body: requestBody
      };
      
      this.activeRequests.set(details.requestId, requestInfo);
      
      this.logger.debug('Request intercepted', {
        type: requestType,
        url: details.url,
        requestId: details.requestId,
        sequence: requestInfo.sequence
      });
      
      // Register with lifecycle manager if available
      if (typeof requestLifecycleManager !== 'undefined') {
        requestLifecycleManager.registerRequest(details.requestId, {
          type: requestType,
          url: details.url,
          tabId: details.tabId
        });
      }
      
    } catch (error) {
      this.metrics.errors++;
      this.logger.error('Error handling request', error);
      
      if (typeof errorHandler !== 'undefined') {
        errorHandler.handleError(error, 'optimized_request_handler', {
          requestId: details.requestId,
          url: details.url
        });
      }
    }
  }
  
  /**
   * Handle responses and extract data
   */
  async handleResponse(details) {
    try {
      const requestInfo = this.activeRequests.get(details.requestId);
      if (!requestInfo) {
        return; // Not a request we're tracking
      }
      
      if (details.statusCode !== 200) {
        this.logger.debug('Non-200 response, skipping', { 
          statusCode: details.statusCode,
          url: details.url 
        });
        return;
      }
      
      this.logger.debug('Processing response', {
        type: requestInfo.type,
        url: details.url,
        statusCode: details.statusCode
      });
      
      // Process based on request type
      if (requestInfo.type === 'organizations') {
        await this.processOrganizationsResponse(details, requestInfo);
      } else if (requestInfo.type === 'graphql') {
        await this.processGraphQLResponse(details, requestInfo);
      }
      
    } catch (error) {
      this.metrics.errors++;
      this.logger.error('Error handling response', error);
      
      if (typeof errorHandler !== 'undefined') {
        errorHandler.handleError(error, 'optimized_response_handler', {
          requestId: details.requestId,
          url: details.url
        });
      }
    }
  }
  
  /**
   * Process organizations response
   */
  async processOrganizationsResponse(details, requestInfo) {
    try {
      this.metrics.organizationsProcessed++;
      
      this.logger.info('Organizations response detected', { 
        url: details.url,
        statusCode: details.statusCode,
        sequence: requestInfo.sequence
      });
      
      // Signal content script to capture the organizations data using secure injection
      if (details.tabId > 0) {
        chrome.tabs.sendMessage(details.tabId, {
          type: 'ORGANIZATIONS_RESPONSE_DETECTED',
          requestId: details.requestId,
          url: details.url,
          statusCode: details.statusCode,
          source: 'optimized_background',
          sequence: requestInfo.sequence
        }).catch(error => {
          this.logger.debug('Could not send to content script', error.message);
        });
      }
      
    } catch (error) {
      this.logger.error('Error processing organizations response', error);
    }
  }
  
  /**
   * Process GraphQL response
   */
  async processGraphQLResponse(details, requestInfo) {
    try {
      // Check if this is a tenants query
      if (!this.isTenantsQuery(requestInfo.body)) {
        return;
      }
      
      this.metrics.tenantsProcessed++;
      
      this.logger.info('GraphQL tenants response detected', { 
        url: details.url,
        statusCode: details.statusCode,
        sequence: requestInfo.sequence
      });
      
      // Signal content script to capture the tenants data using secure injection
      if (details.tabId > 0) {
        chrome.tabs.sendMessage(details.tabId, {
          type: 'TENANTS_RESPONSE_DETECTED',
          requestId: details.requestId,
          url: details.url,
          statusCode: details.statusCode,
          source: 'optimized_background',
          sequence: requestInfo.sequence
        }).catch(error => {
          this.logger.debug('Could not send to content script', error.message);
        });
      }
      
    } catch (error) {
      this.logger.error('Error processing GraphQL response', error);
    }
  }
  
  /**
   * Check if GraphQL query is for tenants
   */
  isTenantsQuery(body) {
    if (!body) return false;
    
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    return bodyStr.includes('GetTenants') || 
           bodyStr.includes('applications') ||
           bodyStr.includes('user') ||
           bodyStr.includes('tenants');
  }
  
  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime,
      activeRequests: this.activeRequests.size,
      recentRequests: this.recentRequests.size,
      deduplicationRate: this.metrics.requestsDeduped / Math.max(this.metrics.requestsIntercepted, 1)
    };
  }
  
  /**
   * Shutdown and cleanup
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.activeRequests.clear();
    this.recentRequests.clear();
    
    this.logger.info('OptimizedRequestInterceptor shutdown completed');
  }
}

// Global instance management
let optimizedRequestInterceptor = null;

/**
 * Get or create optimized request interceptor
 */
function getOptimizedRequestInterceptor() {
  if (!optimizedRequestInterceptor) {
    optimizedRequestInterceptor = new OptimizedRequestInterceptor();
  }
  return optimizedRequestInterceptor;
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OptimizedRequestInterceptor,
    getOptimizedRequestInterceptor
  };
}

// Make available globally
if (typeof window !== 'undefined') {
  window.OptimizedRequestInterceptor = OptimizedRequestInterceptor;
  window.getOptimizedRequestInterceptor = getOptimizedRequestInterceptor;
}