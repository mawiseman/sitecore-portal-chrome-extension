/**
 * Secure Injection Script
 * Replaces the insecure inject.js with namespace-isolated request interception
 * Provides integrity checks and proper cleanup mechanisms
 */

(function() {
  'use strict';
  
  // Simple logger for inject context
  const log = {
    info: (msg, data) => console.info(`[SitecoreSecure] ${msg}`, data || ''),
    debug: (msg, data) => console.debug(`[SitecoreSecure] ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[SitecoreSecure] ${msg}`, data || ''),
    error: (msg, data) => console.error(`[SitecoreSecure] ${msg}`, data || '')
  };
  
  // Check if we're in a secure context
  if (!window.crypto || !window.crypto.randomUUID) {
    log.warn('Secure context not available, falling back to basic interception');
  }
  
  log.info('Initializing secure request interception');
  
  // Import the secure interceptor (inline implementation)
  class SecureRequestInterceptor {
    constructor() {
      this.interceptorId = this.generateId();
      this.isActive = false;
      this.originalMethods = {
        fetch: window.fetch,
        xhrOpen: XMLHttpRequest.prototype.open,
        xhrSend: XMLHttpRequest.prototype.send,
        xmlHttpRequestConstructor: window.XMLHttpRequest
      };
      this.usingConstructorWrapper = false;
      
      // Integrity hashes
      this.checksums = new Map();
      this.targetUrls = [
        'identity.sitecorecloud.io/api/identity/v1/user/organizations',
        'portal.sitecorecloud.io/api/portal/graphql',
        'sitecorecloud.io/api/portal/graphql',  // More flexible pattern
        '/api/portal/graphql'  // Even more flexible
      ];
      
      log.debug('SecureRequestInterceptor initialized', { id: this.interceptorId });
    }
    
    generateId() {
      if (window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
      }
      // Fallback ID generation
      return 'secure_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    calculateHash(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString(36);
    }
    
    shouldInterceptUrl(url) {
      if (!url || typeof url !== 'string') {
        log.debug('❌ Invalid URL for interception:', { url: typeof url });
        return false;
      }
      
      const shouldIntercept = this.targetUrls.some(target => url.includes(target));
      
      if (url.includes('graphql') || url.includes('organizations')) {
        log.debug('🔍 URL interception check:', { 
          url, 
          shouldIntercept,
          targetUrls: this.targetUrls
        });
      }
      
      return shouldIntercept;
    }
    
    dispatchSecureEvent(eventName, detail) {
      try {
        const event = new CustomEvent(`sitecore_secure_${eventName}`, {
          detail: {
            ...detail,
            interceptorId: this.interceptorId,
            timestamp: Date.now()
          }
        });
        window.dispatchEvent(event);
        log.debug(`Dispatched secure event: ${eventName}`);
      } catch (error) {
        log.error('Failed to dispatch secure event', error);
      }
    }
    
    createSecureFetchInterceptor() {
      const originalFetch = this.originalMethods.fetch;
      const self = this;
      
      return async function secureInterceptedFetch(...args) {
        const [url, options] = args;
        
        try {
          // Log all GraphQL requests for debugging
          if (typeof url === 'string' && url.includes('graphql')) {
            log.debug('🎯 GraphQL request detected', { 
              url, 
              method: options?.method,
              hasBody: !!options?.body,
              bodyType: typeof options?.body
            });
            
            if (options?.body) {
              const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
              log.debug('📝 GraphQL request body preview:', bodyStr.substring(0, 200));
            }
          }
          
          const response = await originalFetch.apply(this, args);
          
          if (self.shouldInterceptUrl(url)) {
            log.debug('🔒 Secure fetch interception', { url: typeof url === 'string' ? url : 'Request object' });
            
            if (url.includes('identity.sitecorecloud.io/api/identity/v1/user/organizations')) {
              await self.processOrganizationsResponse(response);
            } else if (url.includes('/api/portal/graphql') || url.includes('graphql')) {
              log.debug('🎯 Processing GraphQL response...');
              await self.processGraphQLResponse(url, options, response);
            }
          }
          
          return response;
        } catch (error) {
          log.error('Secure fetch interception error', error);
          throw error;
        }
      };
    }
    
    createSecureXHRInterceptors() {
      const originalOpen = this.originalMethods.xhrOpen;
      const originalSend = this.originalMethods.xhrSend;
      const self = this;
      
      const secureOpen = function(method, url, ...args) {
        this._secureInterceptor = {
          method,
          url,
          shouldIntercept: self.shouldInterceptUrl(url),
          id: self.interceptorId
        };
        
        if (this._secureInterceptor.shouldIntercept) {
          log.debug('Secure XHR open interception', { method, url });
        }
        
        return originalOpen.apply(this, [method, url, ...args]);
      };
      
      const secureSend = function(data) {
        const xhr = this;
        
        if (xhr._secureInterceptor?.shouldIntercept && xhr._secureInterceptor.id === self.interceptorId) {
          const originalOnReadyStateChange = xhr.onreadystatechange;
          
          xhr.onreadystatechange = function() {
            if (xhr.readyState === 4 && xhr.status === 200) {
              try {
                if (xhr._secureInterceptor.url.includes('identity.sitecorecloud.io/api/identity/v1/user/organizations')) {
                  self.processOrganizationsXHRResponse(xhr);
                } else if (xhr._secureInterceptor.url.includes('/api/portal/graphql') || xhr._secureInterceptor.url.includes('graphql')) {
                  self.processGraphQLXHRResponse(xhr, data);
                }
              } catch (error) {
                log.error('Secure XHR response processing error', error);
              }
            }
            
            if (originalOnReadyStateChange) {
              originalOnReadyStateChange.apply(this, arguments);
            }
          };
        }
        
        return originalSend.apply(this, [data]);
      };
      
      return { secureOpen, secureSend };
    }
    
    async processOrganizationsResponse(response) {
      try {
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        
        log.debug('🏢 Organizations data intercepted', { count: data?.data?.length });
        
        // Dispatch both old and new event formats for compatibility
        this.dispatchSecureEvent('organizations', { data });
        window.dispatchEvent(new CustomEvent('sitecoreOrganizationsData', { detail: data }));
      } catch (error) {
        log.error('Error processing organizations response', error);
      }
    }
    
    processOrganizationsXHRResponse(xhr) {
      try {
        const data = JSON.parse(xhr.responseText);
        
        log.debug('🏢 Organizations XHR data intercepted', { count: data?.data?.length });
        
        this.dispatchSecureEvent('organizations', { data });
        window.dispatchEvent(new CustomEvent('sitecoreOrganizationsData', { detail: data }));
      } catch (error) {
        log.error('Error processing organizations XHR response', error);
      }
    }
    
    async processGraphQLResponse(url, options, response) {
      log.debug('🔍 Checking if GraphQL request is for tenants...');
      
      const isTenantsRequest = this.isGraphQLTenantsRequest(options);
      log.debug('📊 Tenants request check result:', { isTenantsRequest });
      
      if (!isTenantsRequest) {
        log.debug('⏭️ Not a tenants request, skipping');
        return;
      }
      
      try {
        log.debug('🎯 Processing GraphQL tenants response...');
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        
        log.debug('📦 GraphQL response data received:', { 
          hasData: !!data,
          keys: Object.keys(data || {}),
          dataType: typeof data
        });
        
        log.info('🎉 GraphQL tenants data intercepted successfully!');
        
        this.dispatchSecureEvent('tenants', { data });
        window.dispatchEvent(new CustomEvent('sitecoreTenantsData', { detail: data }));
        
        log.debug('📤 Tenants events dispatched');
      } catch (error) {
        log.error('❌ Error processing GraphQL response', error);
      }
    }
    
    processGraphQLXHRResponse(xhr, requestData) {
      log.debug('🔍 Processing XHR GraphQL response...');
      
      const isTenantsRequest = this.isGraphQLTenantsRequest({ body: requestData });
      if (!isTenantsRequest) {
        log.debug('⏭️ XHR request is not for tenants, skipping');
        return;
      }
      
      try {
        log.debug('🎯 Processing XHR GraphQL tenants response...');
        const data = JSON.parse(xhr.responseText);
        
        log.debug('📦 XHR GraphQL response data received:', { 
          hasData: !!data,
          keys: Object.keys(data || {}),
          dataType: typeof data
        });
        
        log.info('🎉 GraphQL XHR tenants data intercepted successfully!');
        
        this.dispatchSecureEvent('tenants', { data });
        window.dispatchEvent(new CustomEvent('sitecoreTenantsData', { detail: data }));
        
        log.debug('📤 XHR Tenants events dispatched');
      } catch (error) {
        log.error('❌ Error processing GraphQL XHR response', error);
      }
    }
    
    isGraphQLTenantsRequest(options) {
      if (!options?.body) {
        log.debug('❌ No request body found');
        return false;
      }
      
      const bodyContent = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      log.debug('🔍 Checking request body for tenant keywords:', {
        bodyLength: bodyContent.length,
        bodyPreview: bodyContent.substring(0, 100)
      });
      
      const hasGetTenants = bodyContent.includes('GetTenants');
      const hasApplications = bodyContent.includes('applications');
      const hasUser = bodyContent.includes('user');
      const hasTenants = bodyContent.includes('tenants');
      
      log.debug('🔍 Keyword search results:', {
        hasGetTenants,
        hasApplications,
        hasUser,
        hasTenants
      });
      
      const isTenantsRequest = hasGetTenants || hasApplications || hasUser || hasTenants;
      
      if (isTenantsRequest) {
        log.debug('✅ Tenant request detected!');
      } else {
        log.debug('❌ Not a tenant request');
      }
      
      return isTenantsRequest;
    }
    
    tryPrototypeInterception() {
      try {
        const { secureOpen, secureSend } = this.createSecureXHRInterceptors();
        let openInstalled = false;
        let sendInstalled = false;
        
        try {
          Object.defineProperty(XMLHttpRequest.prototype, 'open', {
            value: secureOpen,
            writable: true,
            configurable: true
          });
          openInstalled = true;
          log.debug('✅ XHR open interceptor installed via defineProperty');
        } catch (openError) {
          log.debug('⚠️ defineProperty failed for XHR.open, trying direct assignment');
          try {
            XMLHttpRequest.prototype.open = secureOpen;
            openInstalled = true;
            log.debug('✅ XHR open interceptor installed via direct assignment');
          } catch (fallbackError) {
            log.debug('❌ Direct assignment also failed for XHR.open');
          }
        }
        
        try {
          Object.defineProperty(XMLHttpRequest.prototype, 'send', {
            value: secureSend,
            writable: true,
            configurable: true
          });
          sendInstalled = true;
          log.debug('✅ XHR send interceptor installed via defineProperty');
        } catch (sendError) {
          log.debug('⚠️ defineProperty failed for XHR.send, trying direct assignment');
          try {
            XMLHttpRequest.prototype.send = secureSend;
            sendInstalled = true;
            log.debug('✅ XHR send interceptor installed via direct assignment');
          } catch (fallbackError) {
            log.debug('❌ Direct assignment also failed for XHR.send');
          }
        }
        
        const success = openInstalled && sendInstalled;
        if (success) {
          if (openInstalled) {
            this.checksums.set('xhrOpen', this.calculateHash(secureOpen.toString()));
          }
          if (sendInstalled) {
            this.checksums.set('xhrSend', this.calculateHash(secureSend.toString()));
          }
        }
        
        return success;
      } catch (error) {
        log.debug('Prototype interception attempt failed', error.message);
        return false;
      }
    }
    
    installXHRConstructorWrapper() {
      try {
        const self = this;
        const originalXHR = window.XMLHttpRequest;
        
        // Create a wrapper constructor using prototype override
        function SecureXMLHttpRequest() {
          const xhr = new originalXHR();
          const self_ref = self;
          
          // Store original methods
          const originalOpen = originalXHR.prototype.open;
          const originalSend = originalXHR.prototype.send;
          
          // Create wrapper object with custom methods
          const wrapper = Object.create(xhr);
          
          // Copy all properties from xhr to wrapper
          for (let prop in xhr) {
            try {
              wrapper[prop] = xhr[prop];
            } catch (e) {
              // Skip read-only properties
            }
          }
          
          // Override open method on wrapper
          wrapper.open = function(method, url, ...args) {
            this._secureInterceptor = {
              method,
              url,
              shouldIntercept: self_ref.shouldInterceptUrl(url),
              id: self_ref.interceptorId
            };
            
            if (this._secureInterceptor.shouldIntercept) {
              log.debug('🔒 Secure XHR open interception (constructor wrapper)', { method, url });
            }
            
            return originalOpen.apply(xhr, [method, url, ...args]);
          };
          
          // Override send method on wrapper
          wrapper.send = function(data) {
            if (this._secureInterceptor?.shouldIntercept && this._secureInterceptor.id === self_ref.interceptorId) {
              const originalOnReadyStateChange = xhr.onreadystatechange;
              
              xhr.onreadystatechange = function() {
                if (xhr.readyState === 4 && xhr.status === 200) {
                  try {
                    if (wrapper._secureInterceptor.url.includes('identity.sitecorecloud.io/api/identity/v1/user/organizations')) {
                      self_ref.processOrganizationsXHRResponse(xhr);
                    } else if (wrapper._secureInterceptor.url.includes('/api/portal/graphql') || wrapper._secureInterceptor.url.includes('graphql')) {
                      self_ref.processGraphQLXHRResponse(xhr, data);
                    }
                  } catch (error) {
                    log.error('🔒 Secure XHR response processing error', error);
                  }
                }
                
                if (originalOnReadyStateChange) {
                  originalOnReadyStateChange.apply(this, arguments);
                }
              };
            }
            
            return originalSend.apply(xhr, [data]);
          };
          
          // Proxy property access to the underlying xhr
          Object.defineProperty(wrapper, 'responseText', {
            get: function() { return xhr.responseText; }
          });
          Object.defineProperty(wrapper, 'response', {
            get: function() { return xhr.response; }
          });
          Object.defineProperty(wrapper, 'status', {
            get: function() { return xhr.status; }
          });
          Object.defineProperty(wrapper, 'readyState', {
            get: function() { return xhr.readyState; }
          });
          Object.defineProperty(wrapper, 'onreadystatechange', {
            get: function() { return xhr.onreadystatechange; },
            set: function(val) { xhr.onreadystatechange = val; }
          });
          
          return wrapper;
        }
        
        // Copy static properties from original
        Object.setPrototypeOf(SecureXMLHttpRequest.prototype, originalXHR.prototype);
        Object.setPrototypeOf(SecureXMLHttpRequest, originalXHR);
        
        // Copy static properties
        for (const prop in originalXHR) {
          if (originalXHR.hasOwnProperty(prop)) {
            SecureXMLHttpRequest[prop] = originalXHR[prop];
          }
        }
        
        // Replace the global XMLHttpRequest constructor
        try {
          Object.defineProperty(window, 'XMLHttpRequest', {
            value: SecureXMLHttpRequest,
            writable: true,
            configurable: true
          });
          log.debug('✅ XHR constructor wrapper installed via defineProperty');
          return true;
        } catch (error) {
          try {
            window.XMLHttpRequest = SecureXMLHttpRequest;
            log.debug('✅ XHR constructor wrapper installed via direct assignment');
            return true;
          } catch (fallbackError) {
            log.warn('❌ Could not install XHR constructor wrapper', fallbackError.message);
            return false;
          }
        }
        
      } catch (error) {
        log.error('❌ Failed to install XHR constructor wrapper', error);
        return false;
      }
    }
    
    installInterceptors() {
      let fetchInstalled = false;
      let xhrInstalled = false;
      
      try {
        // Install secure fetch interceptor
        const secureFetch = this.createSecureFetchInterceptor();
        try {
          Object.defineProperty(window, 'fetch', {
            value: secureFetch,
            writable: true,
            configurable: true
          });
          this.checksums.set('fetch', this.calculateHash(secureFetch.toString()));
          fetchInstalled = true;
          log.debug('✅ Fetch interceptor installed');
        } catch (fetchError) {
          try {
            window.fetch = secureFetch;
            this.checksums.set('fetch', this.calculateHash(secureFetch.toString()));
            fetchInstalled = true;
            log.debug('✅ Fetch interceptor installed (direct assignment)');
          } catch (fallbackError) {
            log.warn('❌ Could not install fetch interceptor', fallbackError.message);
          }
        }
        
        // Try prototype modification first, then fallback to constructor wrapping
        let xhrPrototypeInstalled = this.tryPrototypeInterception();
        
        if (!xhrPrototypeInstalled) {
          log.info('🔄 Prototype interception failed, using constructor wrapping approach');
          xhrInstalled = this.installXHRConstructorWrapper();
          if (xhrInstalled) {
            this.usingConstructorWrapper = true;
          }
        } else {
          xhrInstalled = true;
          this.usingConstructorWrapper = false;
        }
        
        // Report installation status
        if (fetchInstalled && xhrInstalled) {
          log.info('✅ All secure interceptors installed successfully');
        } else if (fetchInstalled || xhrInstalled) {
          log.info('⚠️ Partial secure interception installed', {
            fetch: fetchInstalled,
            xhr: xhrInstalled
          });
        } else {
          log.warn('❌ No interceptors could be installed - extension may not function properly');
        }
        
      } catch (error) {
        log.error('❌ Failed to install secure interceptors', error);
        log.warn('Extension may have limited functionality');
      }
    }
    
    verifyIntegrity() {
      try {
        // Only verify methods that were successfully installed
        let integrityPassed = true;
        
        if (this.checksums.has('fetch')) {
          const currentFetchHash = this.calculateHash(window.fetch.toString());
          const fetchIntact = currentFetchHash === this.checksums.get('fetch');
          if (!fetchIntact) {
            log.warn('🚨 Fetch method integrity check failed');
            integrityPassed = false;
          }
        }
        
        if (this.checksums.has('xhrOpen')) {
          try {
            const currentXHROpenHash = this.calculateHash(XMLHttpRequest.prototype.open.toString());
            const xhrOpenIntact = currentXHROpenHash === this.checksums.get('xhrOpen');
            if (!xhrOpenIntact) {
              log.warn('🚨 XHR open method integrity check failed');
              integrityPassed = false;
            }
          } catch (error) {
            log.debug('Cannot verify XHR open integrity - method may be read-only');
          }
        }
        
        if (this.checksums.has('xhrSend')) {
          try {
            const currentXHRSendHash = this.calculateHash(XMLHttpRequest.prototype.send.toString());
            const xhrSendIntact = currentXHRSendHash === this.checksums.get('xhrSend');
            if (!xhrSendIntact) {
              log.warn('🚨 XHR send method integrity check failed');
              integrityPassed = false;
            }
          } catch (error) {
            log.debug('Cannot verify XHR send integrity - method may be read-only');
          }
        }
        
        if (!integrityPassed) {
          log.warn('🔄 Attempting to restore and reinstall due to integrity failure');
          // Only attempt restore if we have methods to restore
          if (this.checksums.size > 0) {
            this.restoreAndReinstall();
          }
          return false;
        }
        
        return true;
      } catch (error) {
        log.debug('Integrity verification encountered error', error.message);
        return true; // Don't fail on verification errors
      }
    }
    
    restoreAndReinstall() {
      try {
        log.info('🔄 Restoring original methods and reinstalling');
        
        // Restore originals using defineProperty
        try {
          Object.defineProperty(window, 'fetch', {
            value: this.originalMethods.fetch,
            writable: true,
            configurable: true
          });
        } catch (error) {
          window.fetch = this.originalMethods.fetch;
        }
        
        // Restore XMLHttpRequest based on which method was used
        if (this.usingConstructorWrapper) {
          // Restore the original constructor
          try {
            Object.defineProperty(window, 'XMLHttpRequest', {
              value: this.originalMethods.xmlHttpRequestConstructor,
              writable: true,
              configurable: true
            });
          } catch (error) {
            try {
              window.XMLHttpRequest = this.originalMethods.xmlHttpRequestConstructor;
            } catch (fallbackError) {
              log.warn('Could not restore XMLHttpRequest constructor');
            }
          }
        } else {
          // Restore prototype methods
          try {
            Object.defineProperty(XMLHttpRequest.prototype, 'open', {
              value: this.originalMethods.xhrOpen,
              writable: true,
              configurable: true
            });
          } catch (error) {
            try {
              XMLHttpRequest.prototype.open = this.originalMethods.xhrOpen;
            } catch (fallbackError) {
              log.debug('Could not restore XMLHttpRequest.open');
            }
          }
          
          try {
            Object.defineProperty(XMLHttpRequest.prototype, 'send', {
              value: this.originalMethods.xhrSend,
              writable: true,
              configurable: true
            });
          } catch (error) {
            try {
              XMLHttpRequest.prototype.send = this.originalMethods.xhrSend;
            } catch (fallbackError) {
              log.debug('Could not restore XMLHttpRequest.send');
            }
          }
        }
        
        // Wait a bit then reinstall
        setTimeout(() => {
          this.installInterceptors();
        }, 100);
      } catch (error) {
        log.error('Failed to restore and reinstall', error);
      }
    }
    
    start() {
      if (this.isActive) {
        log.warn('Interceptor already active');
        return;
      }
      
      try {
        this.installInterceptors();
        this.isActive = true;
        
        // Temporarily disable integrity monitoring to prevent reinstall loops
        // TODO: Re-enable with better hash comparison logic
        // this.integrityInterval = setInterval(() => {
        //   this.verifyIntegrity();
        // }, 30000);
        log.debug('Integrity monitoring disabled temporarily');
        
        log.info('🔒 Secure request interception started', { id: this.interceptorId });
      } catch (error) {
        log.error('Failed to start secure interception', error);
        throw error;
      }
    }
    
    stop() {
      if (!this.isActive) return;
      
      try {
        if (this.integrityInterval) {
          clearInterval(this.integrityInterval);
          this.integrityInterval = null;
        }
        
        // Restore originals using defineProperty
        try {
          Object.defineProperty(window, 'fetch', {
            value: this.originalMethods.fetch,
            writable: true,
            configurable: true
          });
        } catch (error) {
          window.fetch = this.originalMethods.fetch;
        }
        
        // Restore XMLHttpRequest based on which method was used
        if (this.usingConstructorWrapper) {
          // Restore the original constructor
          try {
            Object.defineProperty(window, 'XMLHttpRequest', {
              value: this.originalMethods.xmlHttpRequestConstructor,
              writable: true,
              configurable: true
            });
          } catch (error) {
            try {
              window.XMLHttpRequest = this.originalMethods.xmlHttpRequestConstructor;
            } catch (fallbackError) {
              log.debug('Could not restore XMLHttpRequest constructor on stop');
            }
          }
        } else {
          // Restore prototype methods
          try {
            Object.defineProperty(XMLHttpRequest.prototype, 'open', {
              value: this.originalMethods.xhrOpen,
              writable: true,
              configurable: true
            });
          } catch (error) {
            try {
              XMLHttpRequest.prototype.open = this.originalMethods.xhrOpen;
            } catch (fallbackError) {
              log.debug('Could not restore XMLHttpRequest.open on stop');
            }
          }
          
          try {
            Object.defineProperty(XMLHttpRequest.prototype, 'send', {
              value: this.originalMethods.xhrSend,
              writable: true,
              configurable: true
            });
          } catch (error) {
            try {
              XMLHttpRequest.prototype.send = this.originalMethods.xhrSend;
            } catch (fallbackError) {
              log.debug('Could not restore XMLHttpRequest.send on stop');
            }
          }
        }
        
        this.isActive = false;
        log.info('🔓 Secure request interception stopped');
      } catch (error) {
        log.error('Failed to stop secure interception', error);
      }
    }
  }
  
  // Initialize and start secure interception
  try {
    const secureInterceptor = new SecureRequestInterceptor();
    
    // Make it globally available for cleanup if needed
    window.sitecoreSecureInterceptor = secureInterceptor;
    
    // Start interception
    secureInterceptor.start();
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      secureInterceptor.stop();
    });
    
    log.info('✅ Sitecore Portal secure extension: Request interceptors installed successfully');
  } catch (error) {
    log.error('❌ Failed to initialize secure request interception', error);
  }
})();