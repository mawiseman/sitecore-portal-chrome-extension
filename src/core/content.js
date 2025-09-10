class SitecoreOrganizationDetector {
  constructor() {
    this.currentOrgId = null;
    this.logger = Logger.createContextLogger('SitecoreDetector');
    this.interceptRequests();
    this.initCurrentOrgId();
  }

  initCurrentOrgId() {
    // Extract current organization ID from URL if on Sitecore portal
    if (CONFIG.getAllowedDomains().includes(window.location.hostname)) {
      const url = new URL(window.location.href);
      this.currentOrgId = url.searchParams.get("organization");
      if (this.currentOrgId) {
        this.logger.debug("Current organization ID set", { orgId: this.currentOrgId });
      }
    }
  }

  interceptRequests() {
    this.logger.info('Setting up request interception via background script');
    
    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'ORGANIZATIONS_RESPONSE_DETECTED') {
        this.logger.info('Background script detected organizations response', { 
          source: message.source,
          sequence: message.sequence 
        });
        
        // Use secure injection to capture the organizations data
        this.captureOrganizationsData(message.url);
      } else if (message.type === 'TENANTS_RESPONSE_DETECTED') {
        this.logger.info('Background script detected tenants response', { 
          source: message.source,
          sequence: message.sequence 
        });
        
        // Use secure injection to capture the tenants data
        this.captureResponseData(message.url);
      }
    });
    
    // Setup secure injection for data capture
    this.setupSecureInject();
    
    this.logger.info('Background message listener registered');
  }
  
  setupFetchFallback() {
    // Keep the fetch interception as a fallback
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('core/secureInject.js');
    script.onload = () => {
      this.logger.debug('Secure inject script loaded');
      script.remove();
    };
    script.onerror = () => {
      this.logger.error('Failed to load secure inject script');
    };
    
    (document.head || document.documentElement).appendChild(script);
    
    // Listen for the custom event from the injected script for tenants data
    const tenantsHandler = (event) => {
      this.logger.debug('Received tenants data from fallback', event.detail);
      this.processTenantsData(event.detail);
    };
    
    if (typeof memoryManager !== 'undefined') {
      memoryManager.addEventListener(window, 'sitecoreTenantsData', tenantsHandler);
    } else {
      window.addEventListener('sitecoreTenantsData', tenantsHandler);
    }
    
    // Listen for the custom event from the injected script for organizations data
    const orgsHandler = (event) => {
      this.logger.debug('Received organizations data from inject script', event.detail);
      this.processOrganizationsData(event.detail);
    };
    
    if (typeof memoryManager !== 'undefined') {
      memoryManager.addEventListener(window, 'sitecoreOrganizationsData', orgsHandler);
    } else {
      window.addEventListener('sitecoreOrganizationsData', orgsHandler);
    }
    
    // Also listen for secure events from the new secure interceptor
    const secureTenantsHandler = (event) => {
      this.logger.debug('Received secure tenants data', event.detail);
      if (event.detail && event.detail.data) {
        this.processTenantsData(event.detail.data);
      }
    };
    
    const secureOrgsHandler = (event) => {
      this.logger.debug('Received secure organizations data', event.detail);
      if (event.detail && event.detail.data) {
        this.processOrganizationsData(event.detail.data);
      }
    };
    
    if (typeof memoryManager !== 'undefined') {
      memoryManager.addEventListener(window, 'sitecore_secure_tenants', secureTenantsHandler);
      memoryManager.addEventListener(window, 'sitecore_secure_organizations', secureOrgsHandler);
    } else {
      window.addEventListener('sitecore_secure_tenants', secureTenantsHandler);
      window.addEventListener('sitecore_secure_organizations', secureOrgsHandler);
    }
  }
  
  setupSecureInject() {
    // Load secure injection script for data capture
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('core/secureInject.js');
    script.onload = () => {
      this.logger.debug('Secure inject script loaded');
      script.remove();
    };
    script.onerror = () => {
      this.logger.error('Failed to load secure inject script');
    };
    
    (document.head || document.documentElement).appendChild(script);
    
    // Listen for secure events from the injection script
    const secureOrgsHandler = (event) => {
      this.logger.debug('Received secure organizations data', event.detail);
      if (event.detail && event.detail.data) {
        this.processOrganizationsData(event.detail.data);
      }
    };
    
    const secureTenantsHandler = (event) => {
      this.logger.debug('Received secure tenants data', event.detail);
      if (event.detail && event.detail.data) {
        this.processTenantsData(event.detail.data);
      }
    };
    
    if (typeof memoryManager !== 'undefined') {
      memoryManager.addEventListener(window, 'sitecore_secure_organizations', secureOrgsHandler);
      memoryManager.addEventListener(window, 'sitecore_secure_tenants', secureTenantsHandler);
    } else {
      window.addEventListener('sitecore_secure_organizations', secureOrgsHandler);
      window.addEventListener('sitecore_secure_tenants', secureTenantsHandler);
    }
  }

  async captureOrganizationsData(url) {
    this.logger.debug('Organizations data will be captured by secure inject script');
    // The secure inject script will capture the actual response and send it via custom event
    // No need to make a duplicate request here
  }

  async processOrganizationsData(responseData) {
    return await AsyncUtils.safeExecute(async () => {
      // Use shared API client for processing
      const processedOrgs = await sitecoreApiClient.processOrganizationsResponse(responseData, this.currentOrgId);
      
      if (processedOrgs.length === 0) {
        this.logger.debug('No valid organizations to process');
        return;
      }

      // Get existing organizations using shared storage manager
      const existingOrgs = await storageManager.getOrganizations();

      // Merge organizations using shared data processor
      const mergedOrgs = DataProcessor.mergeOrganizations(existingOrgs, processedOrgs);
      
      // Save using shared storage manager
      const success = await storageManager.saveOrganizations(mergedOrgs);
      
      if (success) {
        this.logger.info(`Successfully processed and saved ${processedOrgs.length} organizations`);
      } else {
        throw new Error('Failed to save processed organizations');
      }
    }, {
      timeout: CONFIG.get('TIMEOUTS.API_PROCESSING') || 10000,
      retries: 2,
      context: 'process_organizations_data',
      fallback: async (error) => {
        this.logger.warn('Organization processing failed, continuing without save', error);
        return false;
      }
    });
  }

  async captureResponseData(url) {
    this.logger.debug('Tenant data will be captured by secure inject script');
    // The secure inject script will capture the actual response and send it via custom event
    // No need to make a duplicate request here
  }

  async processTenantsData(responseData) {
    try {
      if (!responseData?.data?.user?.applications?.nodes) {
        this.logger.debug('No tenant data found in response');
        return;
      }

      const nodes = responseData.data.user.applications.nodes;
      this.logger.info(`Processing ${nodes.length} tenant nodes`);

      // Group subsites by product type
      const productGroups = {};
      
      for (const node of nodes) {
        // Skip if not for current organization
        if (this.currentOrgId && node.organizationId !== this.currentOrgId) {
          continue;
        }

        // Get all actions for this node
        const actions = node.appearance?.web?.actions?.nodes || [];
        const mainAction = actions[0]; // First action is usually the main product link
        
        if (mainAction) {
          const productName = mainAction.name || node.productCode;
          const iconSrc = mainAction.icon?.src || '';
          
          // Initialize product group if not exists
          if (!productGroups[productName]) {
            productGroups[productName] = {
              productName,
              iconSrc,
              tenants: []
            };
          }
          
          // Create and validate tenant data
          const tenantData = {
            id: node.id,
            name: node.name,
            displayName: node.displayName || mainAction.displayName,
            url: mainAction.link?.to || null,
            organizationId: node.organizationId,
            actions: actions.map(action => ({
              name: action.name,
              displayName: action.displayName,
              url: action.link?.to,
              category: action.category,
              description: action.description,
              icon: action.icon ? {
                src: action.icon.src,
                type: action.icon.type
              } : null
            }))
          };

          try {
            // Validate and sanitize tenant data
            const sanitizedTenant = SecurityUtils.validateTenantData(tenantData);
            
            // Add validated tenant to the product group
            productGroups[productName].tenants.push(sanitizedTenant);
          } catch (validationError) {
            this.logger.warn(`Skipping invalid tenant data: ${node.id} - ${validationError.message}`, { node, tenantData });
            // Continue with next tenant
            continue;
          }
        }
      }
      
      // Convert groups to array format for storage
      const groupedSubsites = Object.values(productGroups);
      
      if (groupedSubsites.length > 0 && this.currentOrgId) {
        await this.saveGroupedSubsites(groupedSubsites);
      }
      
      this.logger.info(`Processed ${groupedSubsites.length} product groups for current org`);
    } catch (error) {
      this.logger.error('Error processing tenants data', error);
    }
  }

  async saveGroupedSubsites(groupedSubsites) {
    return await AsyncUtils.safeExecute(async () => {
      if (!this.currentOrgId) {
        this.logger.warn("No current organization ID to save subsites to - attempting to detect from subsites");
        
        // Try to extract organization ID from subsites if available
        if (groupedSubsites && groupedSubsites.length > 0) {
          const firstGroup = groupedSubsites[0];
          if (firstGroup.tenants && firstGroup.tenants.length > 0) {
            const firstTenant = firstGroup.tenants[0];
            if (firstTenant.organizationId) {
              // Ensure organizationId is a string, not an encrypted object
              const orgId = firstTenant.organizationId;
              if (typeof orgId === 'string') {
                this.currentOrgId = orgId;
                this.logger.info("Detected organization ID from tenant data", { orgId: this.currentOrgId });
              } else if (typeof orgId === 'object' && orgId.data) {
                // Handle case where it might be an encrypted object
                this.currentOrgId = orgId.data;
                this.logger.info("Detected organization ID from tenant data (was encrypted)", { orgId: this.currentOrgId });
              } else {
                this.logger.warn("Organization ID in tenant is not a valid string", { 
                  orgId: JSON.stringify(orgId) 
                });
              }
            }
          }
        }
        
        if (!this.currentOrgId) {
          this.logger.warn("Could not determine organization ID - skipping subsite save");
          return false;
        }
      }

      // Ensure currentOrgId is a string before updating
      const orgIdToUse = typeof this.currentOrgId === 'string' 
        ? this.currentOrgId 
        : (this.currentOrgId?.data || String(this.currentOrgId));
      
      // Update the specific organization using shared storage manager
      const success = await storageManager.updateOrganization(orgIdToUse, {
        productGroups: groupedSubsites,
        lastSubsiteUpdate: new Date().toISOString()
      });

      if (success) {
        this.logger.info(`Saved ${groupedSubsites.length} product groups for org ${orgIdToUse}`);
      } else {
        this.logger.warn(`Organization not found or could not save subsites for org ${orgIdToUse}`);
        // Don't throw - just return false
        return false;
      }
      
      return success;
    }, {
      timeout: CONFIG.get('TIMEOUTS.STORAGE') || 5000,
      retries: 2,
      context: 'save_grouped_subsites',
      fallback: async (error) => {
        this.logger.warn("Failed to save subsites after retries", { 
          error: error.message,
          orgId: this.currentOrgId 
        });
        return false;
      }
    });
  }

  async saveSubsites(subsites) {
    // Legacy method - convert to grouped format
    const productGroups = {};
    
    for (const subsite of subsites) {
      const productName = subsite.productName || 'Unknown';
      
      if (!productGroups[productName]) {
        productGroups[productName] = {
          productName,
          iconSrc: subsite.iconSrc || '',
          tenants: []
        };
      }
      
      productGroups[productName].tenants.push({
        id: subsite.id,
        name: subsite.name,
        displayName: subsite.displayName,
        url: subsite.url,
        organizationId: subsite.organizationId
      });
    }
    
    await this.saveGroupedSubsites(Object.values(productGroups));
  }
}

// Initialize the detector immediately
const sitecoreOrganizationDetector = new SitecoreOrganizationDetector();

// Listen for URL changes to update current organization ID
// URL Observer Manager with proper cleanup
class URLObserverManager {
  constructor() {
    this.currentUrl = window.location.href;
    this.observer = null;
    this.isObserving = false;
    this.popstateHandler = this.handlePopstate.bind(this);
    this.init();
  }

  init() {
    this.createObserver();
    this.startObserving();
    this.addPopstateListener();
  }

  createObserver() {
    this.observer = new MutationObserver(() => {
      if (this.currentUrl !== window.location.href) {
        this.currentUrl = window.location.href;
        sitecoreOrganizationDetector.initCurrentOrgId();
        Logger.debug("URL changed, updated current org ID", { currentUrl: this.currentUrl }, 'URLObserver');
      }
    });
    
    // Register with memory manager for cleanup
    if (typeof memoryManager !== 'undefined') {
      memoryManager.registerObserver(this.observer, CONFIG.get('TIMEOUTS.OBSERVER_TIMEOUT'));
    }
  }

  startObserving() {
    if (document.body && this.observer && !this.isObserving) {
      this.observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      this.isObserving = true;
      Logger.debug('URL observer started', null, 'Observer');
    } else if (!document.body) {
      // Wait for document.body to be available
      setTimeout(() => this.startObserving(), CONFIG.get('TIMEOUTS.REQUEST_DEBOUNCE') / 50);
    }
  }

  addPopstateListener() {
    if (typeof memoryManager !== 'undefined') {
      memoryManager.addEventListener(window, 'popstate', this.popstateHandler);
    } else {
      window.addEventListener('popstate', this.popstateHandler);
    }
  }

  handlePopstate() {
    sitecoreOrganizationDetector.initCurrentOrgId();
    Logger.debug("Browser navigation detected, updated current org ID", null, 'PopState');
  }

  cleanup() {
    if (this.observer) {
      if (typeof memoryManager !== 'undefined') {
        memoryManager.disconnectObserver(this.observer);
        memoryManager.removeEventListener(window, 'popstate', this.popstateHandler);
      } else {
        this.observer.disconnect();
        window.removeEventListener('popstate', this.popstateHandler);
      }
      this.observer = null;
      this.isObserving = false;
      Logger.debug('URL observer cleaned up', null, 'Observer');
    }
  }
}

// Initialize URL observer manager
const urlObserverManager = new URLObserverManager();

// Global unhandled Promise rejection handler
window.addEventListener('unhandledrejection', async (event) => {
  Logger.error('Unhandled Promise rejection in content script:', event.reason);
  
  if (typeof errorHandler !== 'undefined') {
    event.preventDefault();
    await errorHandler.handleError(event.reason, 'unhandled_promise_rejection', {
      context: 'content_script',
      promiseRejection: true,
      url: window.location.href
    });
  }
});

