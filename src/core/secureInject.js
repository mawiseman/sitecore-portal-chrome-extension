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
        
        // Check if we need to replace placeholder organization
        if (window.__needsOrgUpdate && data?.data?.length > 0) {
          log.info('🔄 Replacing placeholder organization with real data');
          window.__needsOrgUpdate = false;
        }
        
        // Store the real organizations
        window.__sitecoreOrganizations = data?.data || [];
        
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
        
        // Check if we need to replace placeholder organization
        if (window.__needsOrgUpdate && data?.data?.length > 0) {
          log.info('🔄 Replacing placeholder organization with real data');
          window.__needsOrgUpdate = false;
        }
        
        // Store the real organizations
        window.__sitecoreOrganizations = data?.data || [];
        
        this.dispatchSecureEvent('organizations', { data });
        window.dispatchEvent(new CustomEvent('sitecoreOrganizationsData', { detail: data }));
      } catch (error) {
        log.error('Error processing organizations XHR response', error);
      }
    }
    
    async processGraphQLResponse(url, options, response) {
      log.debug('🔍 Checking GraphQL request type...');
      
      const isTenantsRequest = this.isGraphQLTenantsRequest(options);
      const isUserOrgDepsRequest = this.isGraphQLUserOrgDepsRequest(options);
      
      log.debug('📊 Request check results:', { isTenantsRequest, isUserOrgDepsRequest });
      
      if (!isTenantsRequest && !isUserOrgDepsRequest) {
        log.debug('⏭️ Not a relevant GraphQL request, skipping');
        return;
      }
      
      try {
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        
        log.debug('📦 GraphQL response data received:', { 
          hasData: !!data,
          keys: Object.keys(data || {}),
          dataType: typeof data
        });
        
        if (isUserOrgDepsRequest) {
          log.debug('🎯 Processing GraphQL GetUserOrgDeps response...');
          
          // Process GetUserOrgDeps to ensure organization exists
          this.processUserOrgDepsData(data);
          
          log.info('🎉 GraphQL GetUserOrgDeps data intercepted successfully!');
          
          // Dispatch event for GetUserOrgDeps
          this.dispatchSecureEvent('userOrgDeps', { data });
          window.dispatchEvent(new CustomEvent('sitecoreUserOrgDepsData', { detail: data }));
        }
        
        if (isTenantsRequest) {
          log.debug('🎯 Processing GraphQL tenants response...');
          
          // Check if we need to create a placeholder organization
          this.ensureOrganizationExists(data);
          
          log.info('🎉 GraphQL tenants data intercepted successfully!');
          
          this.dispatchSecureEvent('tenants', { data });
          window.dispatchEvent(new CustomEvent('sitecoreTenantsData', { detail: data }));
        }
        
        log.debug('📤 GraphQL events dispatched');
      } catch (error) {
        log.error('❌ Error processing GraphQL response', error);
      }
    }
    
    processGraphQLXHRResponse(xhr, requestData) {
      log.debug('🔍 Processing XHR GraphQL response...');
      
      const isTenantsRequest = this.isGraphQLTenantsRequest({ body: requestData });
      const isUserOrgDepsRequest = this.isGraphQLUserOrgDepsRequest({ body: requestData });
      
      if (!isTenantsRequest && !isUserOrgDepsRequest) {
        log.debug('⏭️ XHR request is not relevant, skipping');
        return;
      }
      
      try {
        const data = JSON.parse(xhr.responseText);
        
        log.debug('📦 XHR GraphQL response data received:', { 
          hasData: !!data,
          keys: Object.keys(data || {}),
          dataType: typeof data
        });
        
        if (isUserOrgDepsRequest) {
          log.debug('🎯 Processing XHR GraphQL GetUserOrgDeps response...');
          
          // Process GetUserOrgDeps to ensure organization exists
          this.processUserOrgDepsData(data);
          
          log.info('🎉 GraphQL XHR GetUserOrgDeps data intercepted successfully!');
          
          // Dispatch event for GetUserOrgDeps
          this.dispatchSecureEvent('userOrgDeps', { data });
          window.dispatchEvent(new CustomEvent('sitecoreUserOrgDepsData', { detail: data }));
        }
        
        if (isTenantsRequest) {
          log.debug('🎯 Processing XHR GraphQL tenants response...');
          
          // Check if we need to create a placeholder organization
          this.ensureOrganizationExists(data);
          
          log.info('🎉 GraphQL XHR tenants data intercepted successfully!');
          
          this.dispatchSecureEvent('tenants', { data });
          window.dispatchEvent(new CustomEvent('sitecoreTenantsData', { detail: data }));
        }
        
        log.debug('📤 XHR GraphQL events dispatched');
      } catch (error) {
        log.error('❌ Error processing GraphQL XHR response', error);
      }
    }
    
    ensureOrganizationExists(tenantsData) {
      try {
        // Check if we have any existing organizations
        const existingOrgs = window.__sitecoreOrganizations || [];
        
        if (existingOrgs.length === 0) {
          log.info('🏢 No organizations found, extracting from tenants data and creating placeholder');
          
          // Extract organization ID from tenants data
          let orgId = null;
          let orgName = 'New Organization';
          
          // Try to extract organization info from the GraphQL response
          if (tenantsData?.data?.user?.tenants?.length > 0) {
            const firstTenant = tenantsData.data.user.tenants[0];
            orgId = firstTenant.organizationId || firstTenant.orgId;
            orgName = firstTenant.organizationName || firstTenant.orgName || orgName;
            
            log.debug('📊 Extracted org info from tenants:', { orgId, orgName });
          }
          
          // If still no orgId, try to extract from different response structure
          if (!orgId && tenantsData?.data?.GetTenants?.length > 0) {
            const firstTenant = tenantsData.data.GetTenants[0];
            orgId = firstTenant.organizationId || firstTenant.orgId;
            orgName = firstTenant.organizationName || firstTenant.orgName || orgName;
            
            log.debug('📊 Extracted org info from GetTenants:', { orgId, orgName });
          }
          
          // If still no orgId, try a more generic search through the data
          if (!orgId) {
            const searchForOrgId = (obj) => {
              if (!obj || typeof obj !== 'object') return null;
              
              if (obj.organizationId) return obj.organizationId;
              if (obj.orgId) return obj.orgId;
              
              for (const key in obj) {
                if (typeof obj[key] === 'object') {
                  const found = searchForOrgId(obj[key]);
                  if (found) return found;
                }
              }
              return null;
            };
            
            orgId = searchForOrgId(tenantsData);
            log.debug('📊 Deep search for org ID:', { orgId });
          }
          
          // Use extracted ID or fallback to placeholder
          const finalOrgId = orgId || ('placeholder-org-' + Date.now());
          
          // Create a placeholder organization with real linking values
          const placeholderOrg = {
            id: finalOrgId,
            name: orgName,
            displayName: orgName,
            originalName: orgName.toLowerCase().replace(/\s+/g, '-'),
            type: orgId ? 'standard' : 'placeholder',
            region: 'us-east-1',
            accountId: null,
            mfaRequired: false,
            url: orgId ? `https://portal.sitecorecloud.io/?organization=${finalOrgId}` : '#',
            lastUpdated: new Date().toISOString(),
            isPlaceholder: true
          };
          
          log.info('🏢 Creating placeholder organization with ID:', finalOrgId);
          
          // Store the placeholder organization
          window.__sitecoreOrganizations = [placeholderOrg];
          
          // Dispatch an event with the placeholder organization
          const placeholderOrgData = {
            data: [placeholderOrg]
          };
          
          this.dispatchSecureEvent('organizations', { data: placeholderOrgData });
          window.dispatchEvent(new CustomEvent('sitecoreOrganizationsData', { detail: placeholderOrgData }));
          
          log.debug('📤 Placeholder organization created and dispatched', placeholderOrg);
          
          // Mark that we need to update this when real org data arrives
          window.__needsOrgUpdate = true;
        }
      } catch (error) {
        log.error('❌ Error ensuring organization exists', error);
      }
    }
    
    processUserOrgDepsData(data) {
      try {
        log.debug('🔍 Processing GetUserOrgDeps data for organization info...');
        
        // Check if we have any existing organizations
        const existingOrgs = window.__sitecoreOrganizations || [];
        
        if (existingOrgs.length === 0) {
          log.info('🏢 No organizations found, extracting from GetUserOrgDeps data');
          
          // Extract organization info from GetUserOrgDeps response
          let orgId = null;
          let orgName = 'New Organization';
          let orgData = null;
          
          // Try to extract organization from GetUserOrgDeps response structure
          if (data?.data?.GetUserOrgDeps?.org) {
            const org = data.data.GetUserOrgDeps.org;
            orgId = org.id || org.orgId;
            orgName = org.name || org.displayName || orgName;
            orgData = org;
            
            log.debug('📊 Extracted org from GetUserOrgDeps.org:', { orgId, orgName });
          }
          
          // Try alternative structure: data.data.organization
          if (!orgId && data?.data?.organization) {
            const org = data.data.organization;
            orgId = org.id || org.orgId;
            orgName = org.name || org.displayName || orgName;
            orgData = org;
            
            log.debug('📊 Extracted org from data.organization:', { orgId, orgName });
          }
          
          // Try to find organization in user data
          if (!orgId && data?.data?.GetUserOrgDeps?.user?.organization) {
            const org = data.data.GetUserOrgDeps.user.organization;
            orgId = org.id || org.orgId;
            orgName = org.name || org.displayName || orgName;
            orgData = org;
            
            log.debug('📊 Extracted org from user.organization:', { orgId, orgName });
          }
          
          if (orgId) {
            // Create organization from GetUserOrgDeps data
            const organization = {
              id: orgId,
              name: orgName,
              displayName: orgData?.displayName || orgName,
              originalName: orgData?.originalName || orgName.toLowerCase().replace(/\s+/g, '-'),
              type: orgData?.type || 'standard',
              region: orgData?.region || orgData?.defaultDeploymentRegion || 'us-east-1',
              accountId: orgData?.accountId || null,
              mfaRequired: orgData?.mfa?.required || false,
              url: `https://portal.sitecorecloud.io/?organization=${orgId}`,
              lastUpdated: new Date().toISOString(),
              fromUserOrgDeps: true
            };
            
            log.info('🏢 Creating organization from GetUserOrgDeps with ID:', orgId);
            
            // Store the organization
            window.__sitecoreOrganizations = [organization];
            
            // Dispatch organization event
            const orgEventData = {
              data: [organization]
            };
            
            this.dispatchSecureEvent('organizations', { data: orgEventData });
            window.dispatchEvent(new CustomEvent('sitecoreOrganizationsData', { detail: orgEventData }));
            
            log.debug('📤 Organization from GetUserOrgDeps created and dispatched', organization);
            
            // Mark that we may still need to update with full org data
            window.__needsOrgUpdate = true;
          } else {
            log.debug('⚠️ Could not extract organization ID from GetUserOrgDeps data');
          }
        } else {
          log.debug('✅ Organizations already exist, skipping GetUserOrgDeps org creation');
        }
      } catch (error) {
        log.error('❌ Error processing GetUserOrgDeps data', error);
      }
    }
    
    isGraphQLUserOrgDepsRequest(options) {
      // Check URL parameters first (most reliable)
      const url = options?.url || '';
      if (url.includes('GetUserOrgDeps')) {
        log.debug('✅ GetUserOrgDeps detected in URL');
        return true;
      }
      
      // Check request body as fallback
      if (options?.body) {
        const bodyContent = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        
        // Check for GetUserOrgDeps operation name in the query
        if (bodyContent.includes('"operationName":"GetUserOrgDeps"') || 
            bodyContent.includes("'operationName':'GetUserOrgDeps'") ||
            bodyContent.includes('query GetUserOrgDeps')) {
          log.debug('✅ GetUserOrgDeps request detected in body!');
          return true;
        }
      }
      
      return false;
    }
    
    isGraphQLTenantsRequest(options) {
      // Check URL parameters first (most reliable)
      const url = options?.url || '';
      if (url.includes('GetTenants')) {
        log.debug('✅ GetTenants detected in URL');
        return true;
      }
      
      if (!options?.body) {
        log.debug('❌ No request body found');
        return false;
      }
      
      const bodyContent = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      
      // Check for GetTenants operation name specifically
      const hasGetTenantsOperation = bodyContent.includes('"operationName":"GetTenants"') || 
                                     bodyContent.includes("'operationName':'GetTenants'") ||
                                     bodyContent.includes('query GetTenants');
      
      // Check for user.applications query pattern (common in GetTenants)
      const hasUserApplicationsQuery = bodyContent.includes('user') && 
                                       bodyContent.includes('applications') && 
                                       (bodyContent.includes('nodes') || bodyContent.includes('edges'));
      
      log.debug('🔍 Tenant detection results:', {
        hasGetTenantsOperation,
        hasUserApplicationsQuery,
        bodyPreview: bodyContent.substring(0, 150)
      });
      
      const isTenantsRequest = hasGetTenantsOperation || hasUserApplicationsQuery;
      
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
        
        // Store original methods
        const originalOpen = originalXHR.prototype.open;
        const originalSend = originalXHR.prototype.send;
        
        // Try to override prototype methods first (works in some browsers)
        try {
          const descriptor = Object.getOwnPropertyDescriptor(originalXHR.prototype, 'open');
          if (!descriptor || descriptor.configurable !== false) {
            // Can modify prototype - use direct override
            originalXHR.prototype.open = function(method, url, ...args) {
              this._secureInterceptor = {
                method,
                url,
                shouldIntercept: self.shouldInterceptUrl(url),
                id: self.interceptorId
              };
              
              if (this._secureInterceptor.shouldIntercept) {
                log.debug('🔒 Secure XHR open interception (prototype override)', { method, url });
              }
              
              return originalOpen.apply(this, [method, url, ...args]);
            };
            
            originalXHR.prototype.send = function(data) {
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
                      log.error('🔒 Secure XHR response processing error', error);
                    }
                  }
                  
                  if (originalOnReadyStateChange) {
                    originalOnReadyStateChange.apply(this, arguments);
                  }
                };
              }
              
              return originalSend.apply(this, [data]);
            };
            
            // No need for wrapper constructor, just use the modified prototype
            window.XMLHttpRequest = originalXHR;
            log.info('✅ Secure XHR constructor wrapper installed (prototype override)');
            return;
          }
        } catch (e) {
          // Prototype override failed, fall back to constructor replacement
          log.debug('Prototype override failed, using constructor replacement', e);
        }
        
        // Fallback: Replace constructor with wrapper
        function SecureXMLHttpRequest(...args) {
          const xhr = new originalXHR(...args);
          
          // Store original methods bound to this instance
          const boundOpen = originalOpen.bind(xhr);
          const boundSend = originalSend.bind(xhr);
          
          // Define custom open method using defineProperty
          Object.defineProperty(xhr, 'open', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: function(method, url, ...openArgs) {
              xhr._secureInterceptor = {
                method,
                url,
                shouldIntercept: self.shouldInterceptUrl(url),
                id: self.interceptorId
              };
              
              if (xhr._secureInterceptor.shouldIntercept) {
                log.debug('🔒 Secure XHR open interception (instance wrapper)', { method, url });
              }
              
              return boundOpen(method, url, ...openArgs);
            }
          });
          
          // Define custom send method using defineProperty
          Object.defineProperty(xhr, 'send', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: function(data) {
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
                      log.error('🔒 Secure XHR response processing error', error);
                    }
                  }
                  
                  if (originalOnReadyStateChange) {
                    originalOnReadyStateChange.apply(this, arguments);
                  }
                };
              }
              
              return boundSend(data);
            }
          });
          
          return xhr;
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