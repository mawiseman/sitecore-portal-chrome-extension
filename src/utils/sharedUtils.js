/**
 * Shared Utilities for Chrome Extension
 * Contains reusable functions for storage, API calls, DOM manipulation, and data processing
 */

/**
 * Storage Management Utilities
 */
class StorageManager {
  constructor() {
    this.logger = Logger.createContextLogger('StorageManager');
    
    // Initialize storage consistency manager if available
    try {
      this.consistencyManager = typeof StorageConsistencyManager !== 'undefined' 
        ? new StorageConsistencyManager() 
        : null;
    } catch (error) {
      this.logger.debug('Storage consistency manager not available', error.message);
      this.consistencyManager = null;
    }
  }

  /**
   * Get data from Chrome storage with context validation and error handling
   * @param {string|Array} keys - Storage key(s) to retrieve
   * @param {Object} options - Additional options
   * @returns {Promise<Object|null>} Retrieved data or null if failed
   */
  async get(keys, options = {}) {
    const { context = 'storage_get', fallback = null, timeout = 3000 } = options;
    
    return await AsyncUtils.safeExecute(async () => {
      const result = await contextValidator.safeStorageOperation(
        () => chrome.storage.local.get(keys),
        context
      );
      
      if (result === null) {
        this.logger.warn('Storage get operation failed due to context invalidation', { keys });
        return fallback;
      }
      
      return result;
    }, {
      timeout,
      retries: 2,
      context,
      fallback: async () => fallback
    });
  }

  /**
   * Set data in Chrome storage with context validation and error handling
   * @param {Object} data - Data to store
   * @param {Object} options - Additional options
   * @returns {Promise<boolean>} Success status
   */
  async set(data, options = {}) {
    const { context = 'storage_set', retryOnQuota = true } = options;
    
    try {
      const result = await contextValidator.safeStorageOperation(
        () => chrome.storage.local.set(data),
        context
      );
      
      if (result === null) {
        this.logger.warn('Storage set operation failed due to context invalidation', { dataKeys: Object.keys(data) });
        return false;
      }
      
      return true;
    } catch (error) {
      const recovered = await errorHandler.handleError(error, context, { 
        dataKeys: Object.keys(data),
        dataSize: JSON.stringify(data).length 
      }, async () => {
        // Recovery strategy for quota exceeded
        if (error.message && error.message.includes('quota') && retryOnQuota) {
          return await this.cleanupAndRetry(data, context);
        }
        return false;
      });
      
      return recovered;
    }
  }

  /**
   * Get organizations with standardized error handling and decryption
   * @returns {Promise<Array>} Array of organizations
   */
  async getOrganizations() {
    const result = await this.get([CONFIG.get('STORAGE.ORGANIZATIONS_KEY')], {
      context: 'get_organizations',
      fallback: { [CONFIG.get('STORAGE.ORGANIZATIONS_KEY')]: [] }
    });
    
    const encryptedOrgs = result ? (result[CONFIG.get('STORAGE.ORGANIZATIONS_KEY')] || []) : [];
    
    // Decrypt organizations if StorageSecurityManager is available
    if (typeof storageSecurityManager !== 'undefined' && storageSecurityManager) {
      try {
        return await storageSecurityManager.decryptOrganizations(encryptedOrgs);
      } catch (error) {
        this.logger.warn('Failed to decrypt organizations, returning as-is', error.message);
        return encryptedOrgs;
      }
    }
    
    return encryptedOrgs;
  }

  /**
   * Save organizations with standardized error handling and encryption
   * @param {Array} organizations - Organizations to save
   * @returns {Promise<boolean>} Success status
   */
  async saveOrganizations(organizations) {
    let orgsToSave = organizations;
    
    // Encrypt organizations if StorageSecurityManager is available
    if (typeof storageSecurityManager !== 'undefined' && storageSecurityManager) {
      try {
        orgsToSave = await storageSecurityManager.encryptOrganizations(organizations);
      } catch (error) {
        this.logger.warn('Failed to encrypt organizations, saving as-is', error.message);
        orgsToSave = organizations;
      }
    }
    
    return await this.set(
      { [CONFIG.get('STORAGE.ORGANIZATIONS_KEY')]: orgsToSave },
      { context: 'save_organizations' }
    );
  }

  /**
   * Update a specific organization
   * @param {string} orgId - Organization ID to update
   * @param {Object} updates - Updates to apply
   * @returns {Promise<boolean>} Success status
   */
  async updateOrganization(orgId, updates) {
    try {
      // Get decrypted organizations
      const organizations = await this.getOrganizations();
      const orgIndex = organizations.findIndex(org => org.id === orgId);
      
      if (orgIndex >= 0) {
        // Merge updates with existing organization data
        organizations[orgIndex] = { ...organizations[orgIndex], ...updates };
        
        // Save will handle encryption automatically
        const success = await this.saveOrganizations(organizations);
        
        if (!success) {
          this.logger.warn('Failed to save organization update', { 
          orgId: typeof orgId === 'object' ? JSON.stringify(orgId) : orgId 
        });
        }
        
        return success;
      } else {
        this.logger.warn('Organization not found for update', { 
          orgId: typeof orgId === 'object' ? JSON.stringify(orgId) : orgId, 
          totalOrgs: organizations.length 
        });
        return false;
      }
    } catch (error) {
      this.logger.error('Error updating organization', { 
        orgId: typeof orgId === 'object' ? JSON.stringify(orgId) : orgId, 
        error: error.message 
      });
      return false;
    }
  }

  /**
   * Cleanup storage and retry operation
   * @param {Object} data - Data that failed to save
   * @param {string} context - Operation context
   * @returns {Promise<boolean>} Success status
   */
  async cleanupAndRetry(data, context) {
    try {
      // Get current usage
      const usage = await chrome.storage.local.getBytesInUse();
      this.logger.info('Storage cleanup needed', { usage, limit: CONFIG.get('LIMITS.MAX_STORAGE_SIZE') });
      
      if (usage > CONFIG.get('LIMITS.MAX_STORAGE_SIZE')) {
        // Clean up organizations data
        const organizations = await this.getOrganizations();
        if (organizations.length > CONFIG.get('LIMITS.CLEANUP_BATCH_SIZE')) {
          // Keep only the most recent organizations
          const recent = organizations
            .sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0))
            .slice(0, CONFIG.get('LIMITS.CLEANUP_BATCH_SIZE'));
          
          await this.saveOrganizations(recent);
          this.logger.info('Cleaned up old organizations', { 
            removed: organizations.length - recent.length 
          });
        }
      }
      
      // Retry the original operation
      return await this.set(data, { context: `${context}_retry`, retryOnQuota: false });
    } catch (cleanupError) {
      this.logger.error('Storage cleanup failed', cleanupError);
      return false;
    }
  }
}

/**
 * API Client for Sitecore Services
 */
class SitecoreApiClient {
  constructor() {
    this.logger = Logger.createContextLogger('SitecoreApiClient');
    this.baseUrls = {
      portal: CONFIG.get('API.SITECORE_PORTAL_BASE'),
      identity: CONFIG.get('API.SITECORE_IDENTITY_BASE')
    };
  }

  /**
   * Check if URL matches Sitecore API patterns
   * @param {string} url - URL to check
   * @returns {Object|null} API info if match, null otherwise
   */
  parseApiUrl(url) {
    try {
      const urlObj = new URL(url);
      
      // Organizations API
      if (urlObj.hostname === 'identity.sitecorecloud.io' && 
          url.includes('/api/identity/v1/user/organizations')) {
        return {
          type: 'organizations',
          service: 'identity',
          endpoint: 'organizations'
        };
      }
      
      // GraphQL API (tenants)
      if (urlObj.hostname === 'portal.sitecorecloud.io' && 
          url.includes('/api/portal/graphql')) {
        return {
          type: 'graphql',
          service: 'portal', 
          endpoint: 'graphql'
        };
      }
      
      return null;
    } catch (error) {
      this.logger.debug('URL parsing failed', { url, error: error.message });
      return null;
    }
  }

  /**
   * Process organizations API response
   * @param {Object} responseData - API response data
   * @param {string} currentOrgId - Current organization ID
   * @returns {Promise<Array>} Processed organizations
   */
  async processOrganizationsResponse(responseData, currentOrgId = null) {
    if (!responseData?.data || !Array.isArray(responseData.data)) {
      this.logger.debug('Invalid organizations response format');
      return [];
    }

    const processedOrgs = [];
    
    for (const org of responseData.data) {
      try {
        // Create standardized organization object
        const orgData = {
          id: org.id,
          name: org.displayName || org.name,
          originalName: org.name,
          type: org.type,
          region: org.defaultDeploymentRegion,
          accountId: org.accountId,
          mfaRequired: org.mfa?.required || false,
          url: `${this.baseUrls.portal}/?organization=${org.id}`,
          lastUpdated: new Date().toISOString()
        };

        // Validate and sanitize
        const sanitizedOrg = SecurityUtils.validateOrganizationData(orgData);
        processedOrgs.push(sanitizedOrg);
        
      } catch (validationError) {
        this.logger.warn(`Skipping invalid organization: ${org.id}`, validationError.message);
        continue;
      }
    }

    this.logger.info(`Processed ${processedOrgs.length} organizations from API`);
    return processedOrgs;
  }

  /**
   * Process GraphQL tenants response
   * @param {Object} responseData - GraphQL response data
   * @param {string} currentOrgId - Current organization ID
   * @returns {Promise<Array>} Processed tenant groups
   */
  async processTenantsResponse(responseData, currentOrgId) {
    if (!responseData?.data?.viewer?.organization?.menu?.nodes) {
      this.logger.debug('Invalid tenants response format');
      return [];
    }

    const nodes = responseData.data.viewer.organization.menu.nodes;
    const productGroups = {};

    for (const node of nodes) {
      // Skip if not for current organization
      if (currentOrgId && node.organizationId !== currentOrgId) {
        continue;
      }

      if (node.actions && node.actions.length > 0) {
        const mainAction = node.actions.find(action => action.isPrimary) || node.actions[0];
        const productName = node.displayName || mainAction.displayName;

        if (!productGroups[productName]) {
          productGroups[productName] = {
            name: productName,
            tenants: []
          };
        }

        // Process all actions as tenants
        for (const action of node.actions) {
          if (action.link?.to) {
            try {
              const tenantData = {
                id: `${node.organizationId}-${action.name}`,
                name: action.displayName || action.name,
                displayName: action.displayName,
                url: action.link.to,
                organizationId: node.organizationId,
                productGroup: productName
              };

              const sanitizedTenant = SecurityUtils.validateTenantData(tenantData);
              productGroups[productName].tenants.push(sanitizedTenant);
              
            } catch (validationError) {
              this.logger.warn(`Skipping invalid tenant: ${action.name}`, validationError.message);
            }
          }
        }
      }
    }

    const result = Object.values(productGroups);
    this.logger.info(`Processed ${result.length} product groups for org ${currentOrgId}`);
    return result;
  }
}

/**
 * DOM Manipulation Utilities
 */
class DomUtils {
  /**
   * Create SVG element with attributes
   * @param {string} tag - SVG tag name
   * @param {Object} attributes - SVG attributes
   * @returns {Element} SVG element
   */
  static createSvgElement(tag, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    
    return element;
  }

  /**
   * Create expand/collapse icon
   * @returns {Element} SVG expand icon
   */
  static createExpandIcon() {
    const svg = this.createSvgElement('svg', {
      width: '16',
      height: '16', 
      viewBox: '0 0 16 16',
      class: 'expand-icon'
    });

    const path = this.createSvgElement('path', {
      d: 'M6 4l4 4-4 4',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round'
    });

    svg.appendChild(path);
    return svg;
  }

  /**
   * Create edit icon
   * @returns {Element} SVG edit icon
   */
  static createEditIcon() {
    const svg = this.createSvgElement('svg', {
      width: '14',
      height: '14',
      viewBox: '0 0 16 16',
      class: 'edit-icon'
    });

    const path = this.createSvgElement('path', {
      d: 'M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708L10.5 9.207l-3-3L12.146.146zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 7.793 4.793 2.086 7.086.793 12.793 5.5zM2.5 6.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1H3v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7.5a.5.5 0 0 1 1 0V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6.5z',
      fill: 'currentColor'
    });

    svg.appendChild(path);
    return svg;
  }

  /**
   * Create delete icon
   * @returns {Element} SVG delete icon  
   */
  static createDeleteIcon() {
    const svg = this.createSvgElement('svg', {
      width: '14',
      height: '14',
      viewBox: '0 0 16 16',
      class: 'delete-icon'
    });

    const path = this.createSvgElement('path', {
      d: 'M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z',
      fill: 'currentColor'
    });

    svg.appendChild(path);
    return svg;
  }

  /**
   * Add tracked event listener using memory manager
   * @param {Element} element - Target element
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @param {Object} options - Event options
   */
  static addTrackedEventListener(element, event, handler, options = false) {
    if (typeof memoryManager !== 'undefined') {
      memoryManager.addEventListener(element, event, handler, options);
    } else {
      element.addEventListener(event, handler, options);
    }
  }

  /**
   * Setup inline editing for an element
   * @param {Element} element - Element to make editable
   * @param {Function} saveCallback - Function to call on save
   * @param {Object} options - Configuration options
   */
  static setupInlineEdit(element, saveCallback, options = {}) {
    const {
      placeholder = 'Enter name...',
      maxLength = CONFIG.get('SECURITY.INPUT_VALIDATION.MAX_STRING_LENGTH'),
      debounceDelay = CONFIG.get('UI.DEBOUNCE_DELAY')
    } = options;

    let isEditing = false;
    let originalValue = '';

    const startEdit = (e) => {
      if (isEditing) return;
      e.stopPropagation();
      
      isEditing = true;
      originalValue = element.textContent.trim();
      
      const input = document.createElement('input');
      input.type = 'text';
      input.value = originalValue;
      input.placeholder = placeholder;
      input.maxLength = maxLength;
      input.className = 'inline-edit-input';
      
      // Replace element content
      element.innerHTML = '';
      element.appendChild(input);
      input.focus();
      input.select();

      // Save on Enter, cancel on Escape
      const handleKeydown = async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          await finishEdit(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          await finishEdit(false);
        }
      };

      // Save on blur with debounce
      let blurTimeout;
      const handleBlur = () => {
        blurTimeout = setTimeout(() => finishEdit(true), debounceDelay);
      };

      const finishEdit = async (save) => {
        if (!isEditing) return;
        
        clearTimeout(blurTimeout);
        input.removeEventListener('keydown', handleKeydown);
        input.removeEventListener('blur', handleBlur);
        
        const newValue = save ? input.value.trim() : originalValue;
        
        if (save && newValue !== originalValue && newValue.length > 0) {
          try {
            const success = await saveCallback(newValue, originalValue);
            element.textContent = success ? newValue : originalValue;
          } catch (error) {
            element.textContent = originalValue;
            await errorHandler.handleError(error, 'inline_edit_save', {
              newValue, originalValue
            });
          }
        } else {
          element.textContent = originalValue;
        }
        
        isEditing = false;
      };

      this.addTrackedEventListener(input, 'keydown', handleKeydown);
      this.addTrackedEventListener(input, 'blur', handleBlur);
    };

    this.addTrackedEventListener(element, 'click', startEdit);
    return startEdit;
  }
}

/**
 * Data Processing Utilities
 */
class DataProcessor {
  /**
   * Merge and deduplicate organizations
   * @param {Array} existing - Existing organizations
   * @param {Array} newOrgs - New organizations from API
   * @returns {Array} Merged organizations
   */
  static mergeOrganizations(existing, newOrgs) {
    const merged = [...existing];
    
    for (const newOrg of newOrgs) {
      const existingIndex = merged.findIndex(org => org.id === newOrg.id);
      
      if (existingIndex >= 0) {
        // Update existing with new data, preserve custom fields
        merged[existingIndex] = {
          ...newOrg,
          customName: merged[existingIndex].customName,
          productGroups: merged[existingIndex].productGroups || [],
          lastSubsiteUpdate: merged[existingIndex].lastSubsiteUpdate
        };
      } else {
        // Add new organization
        merged.push({
          ...newOrg,
          productGroups: []
        });
      }
    }
    
    return merged;
  }

  /**
   * Filter organizations by search term
   * @param {Array} organizations - Organizations to filter
   * @param {string} searchTerm - Search term
   * @returns {Array} Filtered organizations
   */
  static filterOrganizations(organizations, searchTerm) {
    if (!searchTerm) return organizations;
    
    const term = searchTerm.toLowerCase();
    return organizations.filter(org => 
      (org.name && org.name.toLowerCase().includes(term)) ||
      (org.customName && org.customName.toLowerCase().includes(term)) ||
      (org.originalName && org.originalName.toLowerCase().includes(term))
    );
  }

  /**
   * Sort organizations by various criteria
   * @param {Array} organizations - Organizations to sort
   * @param {string} sortBy - Sort criteria (name, lastUpdated, etc.)
   * @param {string} direction - Sort direction (asc, desc)
   * @returns {Array} Sorted organizations
   */
  static sortOrganizations(organizations, sortBy = 'name', direction = 'asc') {
    return [...organizations].sort((a, b) => {
      let valueA, valueB;
      
      switch (sortBy) {
        case 'name':
          valueA = (a.customName || a.name || '').toLowerCase();
          valueB = (b.customName || b.name || '').toLowerCase();
          break;
        case 'lastUpdated':
          valueA = new Date(a.lastUpdated || 0);
          valueB = new Date(b.lastUpdated || 0);
          break;
        case 'region':
          valueA = a.region || '';
          valueB = b.region || '';
          break;
        default:
          return 0;
      }
      
      const comparison = valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
      return direction === 'desc' ? -comparison : comparison;
    });
  }
}

// Create global instances
const storageManager = new StorageManager();
const sitecoreApiClient = new SitecoreApiClient();

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    StorageManager,
    SitecoreApiClient, 
    DomUtils,
    DataProcessor,
    storageManager,
    sitecoreApiClient
  };
}

// Make available globally
if (typeof window !== 'undefined') {
  window.storageManager = storageManager;
  window.sitecoreApiClient = sitecoreApiClient;
  window.DomUtils = DomUtils;
  window.DataProcessor = DataProcessor;
}