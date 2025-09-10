(function() {
  // Simple logger for inject context (can't access extension logger)
  const log = {
    info: (msg, data) => console.info(`[SitecoreExtension] ${msg}`, data || ''),
    debug: (msg, data) => console.debug(`[SitecoreExtension] ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[SitecoreExtension] ${msg}`, data || ''),
    error: (msg, data) => log.error(`[SitecoreExtension] ${msg}`, data || '')
  };
  
  log.info('Installing request interceptors');
  
  // Intercept Fetch API
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const [url, options] = args;
    
    log.debug('Fetch request', {
      url: typeof url === 'string' ? url : 'Request object',
      method: options?.method || 'GET',
      hasBody: !!options?.body
    });
    
    const response = await originalFetch.apply(this, args);
    
    // Check for organizations API requests
    const isOrganizationsAPI = url && typeof url === 'string' && 
                              url.includes('identity.sitecorecloud.io/api/identity/v1/user/organizations');
    
    if (isOrganizationsAPI) {
      log.debug('🏢 Organizations API request detected');
      
      // Clone and read the response
      try {
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        log.debug('📊 Intercepted organizations response:', data);
        
        // Send the data to the content script
        window.dispatchEvent(new CustomEvent('sitecoreOrganizationsData', {
          detail: data
        }));
        
        log.debug('📤 Sent organizations data to content script');
      } catch (error) {
        log.error('❌ Error processing organizations response:', error);
      }
    }
    
    // Check for GraphQL requests
    const isGraphQL = url && typeof url === 'string' && url.includes('/api/portal/graphql');
    if (isGraphQL) {
      processGraphQLRequest(url, options, response);
    }
    
    return response;
  };
  
  // Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._method = method;
    this._url = url;
    log.debug('📡 XMLHttpRequest:', { method, url });
    return originalOpen.apply(this, [method, url, ...args]);
  };
  
  XMLHttpRequest.prototype.send = function(data) {
    const xhr = this;
    
    // Check if this is an organizations API request
    if (this._url && this._url.includes('identity.sitecorecloud.io/api/identity/v1/user/organizations')) {
      log.debug('🏢 Organizations API XMLHttpRequest detected');
      
      // Intercept the response
      const originalOnReadyStateChange = xhr.onreadystatechange;
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4 && xhr.status === 200) {
          try {
            const responseData = JSON.parse(xhr.responseText);
            log.debug('📊 Intercepted organizations XMLHttpRequest response:', responseData);
            
            // Send the data to the content script
            window.dispatchEvent(new CustomEvent('sitecoreOrganizationsData', {
              detail: responseData
            }));
            
            log.debug('📤 Sent organizations data to content script');
          } catch (error) {
            log.error('❌ Error processing organizations XMLHttpRequest response:', error);
          }
        }
        
        if (originalOnReadyStateChange) {
          originalOnReadyStateChange.apply(this, arguments);
        }
      };
    }
    
    // Check if this is a GraphQL request
    else if (this._url && this._url.includes('/api/portal/graphql')) {
      log.debug('🎯 GraphQL XMLHttpRequest detected:', {
        method: this._method,
        url: this._url,
        hasData: !!data
      });
      
      // Check request body for tenant queries
      if (data && this._method && this._method.toUpperCase() === 'POST') {
        const bodyContent = typeof data === 'string' ? data : JSON.stringify(data);
        const isTenantsQuery = bodyContent.includes('GetTenants') || 
                             bodyContent.includes('applications') ||
                             bodyContent.includes('user') ||
                             bodyContent.includes('tenants');
        
        log.debug('📝 XMLHttpRequest body check:', {
          bodyLength: bodyContent.length,
          isTenantsQuery,
          bodyPreview: bodyContent.substring(0, 200)
        });
        
        if (isTenantsQuery) {
          log.debug('🎉 Tenants query detected in XMLHttpRequest!');
          
          // Intercept the response
          const originalOnReadyStateChange = xhr.onreadystatechange;
          xhr.onreadystatechange = function() {
            if (xhr.readyState === 4 && xhr.status === 200) {
              try {
                const responseData = JSON.parse(xhr.responseText);
                log.debug('📊 Intercepted XMLHttpRequest response:', responseData);
                
                // Send the data to the content script
                window.dispatchEvent(new CustomEvent('sitecoreTenantsData', {
                  detail: responseData
                }));
                
                log.debug('📤 Sent XMLHttpRequest tenants data to content script');
              } catch (error) {
                log.error('❌ Error processing XMLHttpRequest response:', error);
              }
            }
            
            if (originalOnReadyStateChange) {
              originalOnReadyStateChange.apply(this, arguments);
            }
          };
        }
      }
    }
    
    return originalSend.apply(this, [data]);
  };
  
  // Helper function for processing GraphQL responses (for fetch)
  async function processGraphQLRequest(url, options, response) {
    const isPost = options && options.method && options.method.toUpperCase() === 'POST';
    
    log.debug('🎯 GraphQL fetch request detected:', {
      url,
      method: options?.method,
      isPost
    });
    
    if (isPost && options.body) {
      const bodyContent = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      const isTenantsQuery = bodyContent.includes('GetTenants') || 
                           bodyContent.includes('applications') ||
                           bodyContent.includes('user') ||
                           bodyContent.includes('tenants');
      
      log.debug('📝 Fetch body check:', {
        bodyLength: bodyContent.length,
        isTenantsQuery,
        bodyPreview: bodyContent.substring(0, 200)
      });
      
      if (isTenantsQuery) {
        log.debug('🎉 Tenants query detected in fetch!');
        
        try {
          const clonedResponse = response.clone();
          const data = await clonedResponse.json();
          log.debug('📊 Intercepted fetch response:', data);
          
          window.dispatchEvent(new CustomEvent('sitecoreTenantsData', {
            detail: data
          }));
          
          log.debug('📤 Sent fetch tenants data to content script');
        } catch (error) {
          log.error('❌ Error processing fetch response:', error);
        }
      }
    }
  }
  
  log.debug('✅ Sitecore Portal extension: Request interceptors installed successfully');
})();