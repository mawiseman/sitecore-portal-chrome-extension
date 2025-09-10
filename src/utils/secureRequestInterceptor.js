/**
 * Secure Request Interceptor
 * Provides namespace-isolated request interception with integrity checks
 * and proper cleanup mechanisms to prevent tampering and prototype pollution
 */

class SecureRequestInterceptor {
  constructor() {
    // Private namespace to prevent external tampering
    this.#initializeSecureNamespace();
    
    // Integrity checks
    this.#checksums = new Map();
    this.#isActive = false;
    this.#interceptorId = crypto.randomUUID();
    
    // Logger with fallback
    this.logger = typeof Logger !== 'undefined' 
      ? Logger.createContextLogger('SecureInterceptor') 
      : this.#createFallbackLogger();
    
    // Target URLs to intercept (whitelist approach)
    this.#targetUrls = [
      'identity.sitecorecloud.io/api/identity/v1/user/organizations',
      'portal.sitecorecloud.io/api/portal/graphql'
    ];
    
    // Event listeners registry for cleanup
    this.#eventListeners = new Set();
    
    this.logger.debug('SecureRequestInterceptor initialized', { id: this.#interceptorId });
  }
  
  // Private fields (using # syntax for true privacy)
  #secureNamespace = null;
  #originalMethods = new Map();
  #checksums = null;
  #isActive = false;
  #interceptorId = null;
  #targetUrls = null;
  #eventListeners = null;
  #integrityInterval = null;
  
  /**
   * Initialize secure namespace to isolate our modifications
   */
  #initializeSecureNamespace() {
    // Create a secure isolated namespace
    this.#secureNamespace = {
      // Store original methods safely
      originalFetch: window.fetch,
      originalXHROpen: XMLHttpRequest.prototype.open,
      originalXHRSend: XMLHttpRequest.prototype.send,
      
      // Create integrity hashes
      fetchHash: this.#calculateHash(window.fetch.toString()),
      xhrOpenHash: this.#calculateHash(XMLHttpRequest.prototype.open.toString()),
      xhrSendHash: this.#calculateHash(XMLHttpRequest.prototype.send.toString()),
      
      // Secure event dispatch
      dispatchSecureEvent: (eventName, detail) => {
        const event = new CustomEvent(`sitecore_secure_${eventName}`, {
          detail: {
            ...detail,
            interceptorId: this.#interceptorId,
            timestamp: Date.now()
          }
        });
        window.dispatchEvent(event);
      }
    };
  }
  
  /**
   * Calculate hash for integrity checking
   */
  #calculateHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }
  
  /**
   * Create fallback logger if main logger not available
   */
  #createFallbackLogger() {
    return {
      debug: (...args) => console.debug('[SecureInterceptor]', ...args),
      info: (...args) => console.info('[SecureInterceptor]', ...args),
      warn: (...args) => console.warn('[SecureInterceptor]', ...args),
      error: (...args) => console.error('[SecureInterceptor]', ...args)
    };
  }
  
  /**
   * Check if URL should be intercepted
   */
  #shouldInterceptUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return this.#targetUrls.some(target => url.includes(target));
  }
  
  /**
   * Verify integrity of intercepted methods
   */
  #verifyIntegrity() {
    try {
      const currentFetchHash = this.#calculateHash(window.fetch.toString());
      const currentXHROpenHash = this.#calculateHash(XMLHttpRequest.prototype.open.toString());
      const currentXHRSendHash = this.#calculateHash(XMLHttpRequest.prototype.send.toString());
      
      // Check if our methods are still intact
      const fetchIntact = currentFetchHash === this.#checksums.get('fetch');
      const xhrOpenIntact = currentXHROpenHash === this.#checksums.get('xhrOpen');
      const xhrSendIntact = currentXHRSendHash === this.#checksums.get('xhrSend');
      
      if (!fetchIntact || !xhrOpenIntact || !xhrSendIntact) {
        this.logger.warn('Integrity check failed - methods may have been tampered with', {
          fetchIntact,
          xhrOpenIntact, 
          xhrSendIntact
        });
        
        // Attempt to restore if tampering detected
        this.#restoreOriginalMethods();
        this.#installInterceptors();
        
        return false;
      }
      
      return true;
    } catch (error) {
      this.logger.error('Integrity verification failed', error);
      return false;
    }
  }
  
  /**
   * Secure fetch interceptor
   */
  #createSecureFetchInterceptor() {
    const originalFetch = this.#secureNamespace.originalFetch;
    const self = this;
    
    return async function secureInterceptedFetch(...args) {
      const [url, options] = args;
      
      try {
        // Call original fetch
        const response = await originalFetch.apply(this, args);
        
        // Only process if URL matches our targets
        if (self.#shouldInterceptUrl(url)) {
          self.logger.debug('Secure fetch interception', { url: typeof url === 'string' ? url : 'Request object' });
          
          // Handle organizations API
          if (url.includes('identity.sitecorecloud.io/api/identity/v1/user/organizations')) {
            await self.#processOrganizationsResponse(response);
          }
          // Handle GraphQL API
          else if (url.includes('portal.sitecorecloud.io/api/portal/graphql')) {
            await self.#processGraphQLResponse(url, options, response);
          }
        }
        
        return response;
      } catch (error) {
        self.logger.error('Secure fetch interception error', error);
        throw error;
      }
    };
  }
  
  /**
   * Secure XMLHttpRequest interceptors
   */
  #createSecureXHRInterceptors() {
    const originalOpen = this.#secureNamespace.originalXHROpen;
    const originalSend = this.#secureNamespace.originalXHRSend;
    const self = this;
    
    const secureOpen = function(method, url, ...args) {
      this._secureInterceptor = {
        method,
        url,
        shouldIntercept: self.#shouldInterceptUrl(url)
      };
      
      if (this._secureInterceptor.shouldIntercept) {
        self.logger.debug('Secure XHR open interception', { method, url });
      }
      
      return originalOpen.apply(this, [method, url, ...args]);
    };
    
    const secureSend = function(data) {
      const xhr = this;
      
      if (xhr._secureInterceptor?.shouldIntercept) {
        // Set up secure response interception
        const originalOnReadyStateChange = xhr.onreadystatechange;
        
        xhr.onreadystatechange = function() {
          if (xhr.readyState === 4 && xhr.status === 200) {
            try {
              if (xhr._secureInterceptor.url.includes('identity.sitecorecloud.io/api/identity/v1/user/organizations')) {
                self.#processOrganizationsXHRResponse(xhr);
              } else if (xhr._secureInterceptor.url.includes('portal.sitecorecloud.io/api/portal/graphql')) {
                self.#processGraphQLXHRResponse(xhr, data);
              }
            } catch (error) {
              self.logger.error('Secure XHR response processing error', error);
            }
          }
          
          // Call original handler
          if (originalOnReadyStateChange) {
            originalOnReadyStateChange.apply(this, arguments);
          }
        };
      }
      
      return originalSend.apply(this, [data]);
    };
    
    return { secureOpen, secureSend };
  }
  
  /**
   * Process organizations API response
   */
  async #processOrganizationsResponse(response) {
    try {
      const clonedResponse = response.clone();
      const data = await clonedResponse.json();
      
      this.logger.debug('Organizations data intercepted', { count: data?.data?.length });
      
      this.#secureNamespace.dispatchSecureEvent('organizations', { data });
    } catch (error) {
      this.logger.error('Error processing organizations response', error);
    }
  }
  
  /**
   * Process organizations XHR response
   */
  #processOrganizationsXHRResponse(xhr) {
    try {
      const data = JSON.parse(xhr.responseText);
      
      this.logger.debug('Organizations XHR data intercepted', { count: data?.data?.length });
      
      this.#secureNamespace.dispatchSecureEvent('organizations', { data });
    } catch (error) {
      this.logger.error('Error processing organizations XHR response', error);
    }
  }
  
  /**
   * Process GraphQL response
   */
  async #processGraphQLResponse(url, options, response) {
    if (!this.#isGraphQLTenantsRequest(options)) return;
    
    try {
      const clonedResponse = response.clone();
      const data = await clonedResponse.json();
      
      this.logger.debug('GraphQL tenants data intercepted');
      
      this.#secureNamespace.dispatchSecureEvent('tenants', { data });
    } catch (error) {
      this.logger.error('Error processing GraphQL response', error);
    }
  }
  
  /**
   * Process GraphQL XHR response
   */
  #processGraphQLXHRResponse(xhr, requestData) {
    if (!this.#isGraphQLTenantsRequest({ body: requestData })) return;
    
    try {
      const data = JSON.parse(xhr.responseText);
      
      this.logger.debug('GraphQL XHR tenants data intercepted');
      
      this.#secureNamespace.dispatchSecureEvent('tenants', { data });
    } catch (error) {
      this.logger.error('Error processing GraphQL XHR response', error);
    }
  }
  
  /**
   * Check if GraphQL request is for tenants
   */
  #isGraphQLTenantsRequest(options) {
    if (!options?.body) return false;
    
    const bodyContent = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    return bodyContent.includes('GetTenants') || 
           bodyContent.includes('applications') ||
           bodyContent.includes('user') ||
           bodyContent.includes('tenants');
  }
  
  /**
   * Install secure interceptors
   */
  #installInterceptors() {
    try {
      // Install secure fetch interceptor
      const secureFetch = this.#createSecureFetchInterceptor();
      Object.defineProperty(window, 'fetch', {
        value: secureFetch,
        writable: true,
        configurable: true
      });
      this.#checksums.set('fetch', this.#calculateHash(secureFetch.toString()));
      
      // Install secure XHR interceptors
      const { secureOpen, secureSend } = this.#createSecureXHRInterceptors();
      
      try {
        Object.defineProperty(XMLHttpRequest.prototype, 'open', {
          value: secureOpen,
          writable: true,
          configurable: true
        });
      } catch (openError) {
        this.logger.warn('Could not override XMLHttpRequest.open with defineProperty, trying direct assignment');
        XMLHttpRequest.prototype.open = secureOpen;
      }
      
      try {
        Object.defineProperty(XMLHttpRequest.prototype, 'send', {
          value: secureSend,
          writable: true,
          configurable: true
        });
      } catch (sendError) {
        this.logger.warn('Could not override XMLHttpRequest.send with defineProperty, trying direct assignment');
        XMLHttpRequest.prototype.send = secureSend;
      }
      
      this.#checksums.set('xhrOpen', this.#calculateHash(secureOpen.toString()));
      this.#checksums.set('xhrSend', this.#calculateHash(secureSend.toString()));
      
      this.logger.info('Secure interceptors installed successfully');
    } catch (error) {
      this.logger.error('Failed to install secure interceptors', error);
      this.logger.warn('Continuing with partial functionality');
      // Don't throw - continue with available functionality
    }
  }
  
  /**
   * Restore original methods
   */
  #restoreOriginalMethods() {
    try {
      // Restore fetch
      try {
        Object.defineProperty(window, 'fetch', {
          value: this.#secureNamespace.originalFetch,
          writable: true,
          configurable: true
        });
      } catch (error) {
        window.fetch = this.#secureNamespace.originalFetch;
      }
      
      // Restore XMLHttpRequest.open
      try {
        Object.defineProperty(XMLHttpRequest.prototype, 'open', {
          value: this.#secureNamespace.originalXHROpen,
          writable: true,
          configurable: true
        });
      } catch (error) {
        try {
          XMLHttpRequest.prototype.open = this.#secureNamespace.originalXHROpen;
        } catch (fallbackError) {
          this.logger.warn('Could not restore XMLHttpRequest.open');
        }
      }
      
      // Restore XMLHttpRequest.send
      try {
        Object.defineProperty(XMLHttpRequest.prototype, 'send', {
          value: this.#secureNamespace.originalXHRSend,
          writable: true,
          configurable: true
        });
      } catch (error) {
        try {
          XMLHttpRequest.prototype.send = this.#secureNamespace.originalXHRSend;
        } catch (fallbackError) {
          this.logger.warn('Could not restore XMLHttpRequest.send');
        }
      }
      
      this.logger.debug('Original methods restored');
    } catch (error) {
      this.logger.error('Failed to restore original methods', error);
    }
  }
  
  /**
   * Start secure interception
   */
  start() {
    if (this.#isActive) {
      this.logger.warn('Interceptor already active');
      return;
    }
    
    try {
      this.#installInterceptors();
      this.#isActive = true;
      
      // Start integrity monitoring
      this.#integrityInterval = setInterval(() => {
        this.#verifyIntegrity();
      }, 30000); // Check every 30 seconds
      
      this.logger.info('Secure request interception started', { id: this.#interceptorId });
    } catch (error) {
      this.logger.error('Failed to start secure interception', error);
      throw error;
    }
  }
  
  /**
   * Stop secure interception and cleanup
   */
  stop() {
    if (!this.#isActive) {
      this.logger.warn('Interceptor not active');
      return;
    }
    
    try {
      // Clear integrity monitoring
      if (this.#integrityInterval) {
        clearInterval(this.#integrityInterval);
        this.#integrityInterval = null;
      }
      
      // Restore original methods
      this.#restoreOriginalMethods();
      
      // Clear event listeners
      this.#eventListeners.clear();
      
      this.#isActive = false;
      
      this.logger.info('Secure request interception stopped', { id: this.#interceptorId });
    } catch (error) {
      this.logger.error('Failed to stop secure interception', error);
      throw error;
    }
  }
  
  /**
   * Get interceptor status
   */
  getStatus() {
    return {
      active: this.#isActive,
      id: this.#interceptorId,
      targetUrls: this.#targetUrls.length,
      integrityChecks: this.#checksums.size,
      hasIntegrityMonitoring: !!this.#integrityInterval
    };
  }
  
  /**
   * Add event listener for intercepted data
   */
  addEventListener(eventName, handler) {
    const fullEventName = `sitecore_secure_${eventName}`;
    window.addEventListener(fullEventName, handler);
    this.#eventListeners.add({ eventName: fullEventName, handler });
  }
  
  /**
   * Remove event listener
   */
  removeEventListener(eventName, handler) {
    const fullEventName = `sitecore_secure_${eventName}`;
    window.removeEventListener(fullEventName, handler);
    this.#eventListeners.delete({ eventName: fullEventName, handler });
  }
  
  /**
   * Force integrity check
   */
  checkIntegrity() {
    return this.#verifyIntegrity();
  }
}

// Global instance management
let secureInterceptorInstance = null;

/**
 * Get or create secure interceptor instance
 */
function getSecureInterceptor() {
  if (!secureInterceptorInstance) {
    secureInterceptorInstance = new SecureRequestInterceptor();
  }
  return secureInterceptorInstance;
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SecureRequestInterceptor,
    getSecureInterceptor
  };
}

// Make available globally
if (typeof window !== 'undefined') {
  window.SecureRequestInterceptor = SecureRequestInterceptor;
  window.getSecureInterceptor = getSecureInterceptor;
}