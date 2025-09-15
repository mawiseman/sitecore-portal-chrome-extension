// Note: CONFIG is now loaded from config.js - no local declaration needed

/**
 * Manages organization display and interaction in the popup
 */
class OrganizationManager {
  constructor() {
    this.organizations = [];
    this.currentUrl = "";
    this.logger = Logger.createContextLogger('OrganizationManager');
    this.eventCleanupCallbacks = [];
    
    // Set up cleanup on window close
    this.setupCleanup();
    
    // Listen for user guidance events
    this.setupUserGuidanceListener();
    
    this.init();
  }

  /**
   * Set up cleanup handlers
   */
  setupCleanup() {
    // Handle popup close - using pagehide instead of deprecated unload
    if (typeof memoryManager !== 'undefined') {
      memoryManager.addEventListener(window, 'beforeunload', () => {
        this.cleanup();
      });
      
      // Use pagehide instead of deprecated unload event
      memoryManager.addEventListener(window, 'pagehide', () => {
        this.cleanup();
      });
    } else {
      window.addEventListener('beforeunload', () => {
        this.cleanup();
      });
      
      // Use pagehide instead of deprecated unload event
      window.addEventListener('pagehide', () => {
        this.cleanup();
      });
    }
  }
  
  /**
   * Clean up all event listeners and resources
   */
  cleanup() {
    // Execute all cleanup callbacks
    this.eventCleanupCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        this.logger.error('Error during event cleanup', error);
      }
    });
    this.eventCleanupCallbacks = [];
    
    // Use memory manager cleanup if available
    if (typeof memoryManager !== 'undefined') {
      memoryManager.cleanup();
      this.logger.debug('Memory manager cleanup completed');
    }
    
    this.logger.debug('OrganizationManager cleanup completed');
  }
  
  /**
   * Set up listener for user guidance events from content script
   */
  setupUserGuidanceListener() {
    const handleUserGuidance = (event) => {
      const { message, url } = event.detail;
      this.showUserGuidance(title, message, url);
    };
    
    this.addTrackedEventListener(window, 'sitecore_user_guidance', handleUserGuidance);
  }
  
  /**
   * Display user guidance message to the user
   * @param {string} message - The guidance message
   * @param {string} url - The URL to navigate to
   */
  showUserGuidance(title, message, url) {
    // Remove any existing guidance first to prevent duplicates
    const existingGuidance = document.querySelector('.guidance-container');
    if (existingGuidance) {
      existingGuidance.remove();
    }
    
    // Create new guidance container
    const guidanceContainer = document.createElement('div');
    guidanceContainer.className = 'guidance-container';
    guidanceContainer.innerHTML = `
      <div class="guidance-message">
        <img src="/ui/icons/icon48.png" alt="Sitecore" class="guidance-icon">
        <div class="guidance-title"></div>
        <div class="guidance-text"></div>
        <button class="guidance-button">Open Portal</button>
      </div>
    `;
    
    // Insert at the top of the popup
    const container = document.querySelector('.container');
    container.insertBefore(guidanceContainer, container.firstChild);
    
    // Update message
    const titleElement = guidanceContainer.querySelector('.guidance-title');
    titleElement.textContent = title;

    // Update message
    const textElement = guidanceContainer.querySelector('.guidance-text');
    textElement.textContent = message;
    
    // Set up button handlers
    const openButton = guidanceContainer.querySelector('.guidance-button');
    
    openButton.onclick = async () => {
      try {
        await chrome.tabs.create({ url });
        guidanceContainer.remove();
      } catch (error) {
        this.logger.error('Error opening portal URL', error);
      }
    };
    
    // Show the guidance
    guidanceContainer.style.display = 'block';
    
    this.logger.info('User guidance displayed:', message);
  }
  
  /**
   * Add event listener with cleanup tracking
   */
  addTrackedEventListener(element, event, handler, options = false) {
    if (typeof memoryManager !== 'undefined') {
      memoryManager.addEventListener(element, event, handler, options);
    } else {
      element.addEventListener(event, handler, options);
      
      // Add cleanup callback for fallback
      this.eventCleanupCallbacks.push(() => {
        element.removeEventListener(event, handler, options);
      });
    }
  }

  /**
   * Initializes the organization manager
   * @returns {Promise<void>}
   */
  async init() {
    try {
      await this.loadOrganizations();
      await this.getCurrentUrl();
      this.renderOrganizations();
    } catch (error) {
      this.logger.error("Initialization failed", error);
      this.showError("Failed to load organizations");
    }
  }

  /**
   * Loads organizations from Chrome storage
   * @returns {Promise<void>}
   */
  async loadOrganizations() {
    try {
      // Use shared storage manager
      this.organizations = await storageManager.getOrganizations();
      this.logger.debug(`Loaded ${this.organizations.length} organizations`);
    } catch (error) {
      const recovered = await errorHandler.handleError(error, 'popup_load_organizations', { 
        organizationCount: this.organizations.length 
      }, async () => {
        this.organizations = [];
        return true;
      });
      if (!recovered) throw error;
    }
  }

  /**
   * Gets the URL of the current active tab with timeout
   * @returns {Promise<void>}
   */
  async getCurrentUrl() {
    try {
      const [tab] = await this.withTimeout(
        chrome.tabs.query({ active: true, currentWindow: true }),
        CONFIG.get('TIMEOUTS.CHROME_API') || 5000,
        'getCurrentUrl'
      );
      this.currentUrl = tab?.url || "";
    } catch (error) {
      const recovered = await errorHandler.handleError(error, 'get_current_url', {}, async () => {
        this.currentUrl = "";
        return true;
      });
      if (!recovered) {
        this.currentUrl = "";
      }
    }
  }

  /**
   * Saves organizations back to Chrome storage
   * @returns {Promise<void>}
   */
  async saveOrganizations() {
    try {
      // Use shared storage manager
      const success = await storageManager.saveOrganizations(this.organizations);
      
      if (!success) {
        this.logger.warn('Could not save organizations');
        this.showError('Failed to save changes');
        throw new Error('Save operation failed');
      }
    } catch (error) {
      const recovered = await errorHandler.handleError(error, 'popup_save_organizations', {
        organizationCount: this.organizations.length
      }, async () => {
        // Recovery: try with smaller data set
        const essential = this.organizations.slice(0, CONFIG.get('LIMITS.CLEANUP_BATCH_SIZE'));
        return await storageManager.saveOrganizations(essential);
      });
      if (!recovered) throw error;
    }
  }

  /**
   * Validates if a URL is a valid Sitecore portal URL using enhanced security checks
   * @param {string} url - URL to validate
   * @returns {boolean} True if URL is valid and safe
   */
  isValidSitecoreUrl(url) {
    try {
      return SecurityUtils.isValidSitecoreUrl(url);
    } catch (error) {
      this.logger.warn(`URL validation failed: ${error.message}`, { url });
      return false;
    }
  }

  /**
   * Deletes an organization by ID
   * @param {string} id - Organization ID to delete
   * @returns {Promise<void>}
   */
  async deleteOrganization(id) {
    try {
      const orgToDelete = this.organizations.find(org => org.id === id);
      if (!orgToDelete) {
        this.showError("Organization not found");
        return;
      }

      if (confirm(`Delete "${orgToDelete.name}"?`)) {
        this.organizations = this.organizations.filter((org) => org.id !== id);
        await this.saveOrganizations();
        this.renderOrganizations();
        this.showSuccess(`"${orgToDelete.name}" deleted`);
      }
    } catch (error) {
      this.logger.error("Error deleting organization", error);
      this.showError("Failed to delete organization");
    }
  }

  /**
   * Shows an error message to the user
   * @param {string} message - Error message to display
   */
  showError(message) {
    this.showNotification(message, 'error');
  }

  /**
   * Shows a success message to the user
   * @param {string} message - Success message to display
   */
  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  /**
   * Shows a notification message to the user
   * @param {string} message - Message to display
   * @param {string} type - Type of notification ('error' or 'success')
   */
  showNotification(message, type = 'info') {
    // Remove any existing notifications
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
      existingNotification.remove();
    }

    // Create new notification
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Set notification class based on type
    notification.className = `notification ${type}`;

    document.body.appendChild(notification);

    // Remove after delay
    setTimeout(() => {
      notification.classList.add('slideup');
      setTimeout(() => notification.remove(), 300);
    }, CONFIG.ERROR_DISPLAY_DURATION);
  }

  /**
   * Helper function to determine if organization has subsites
   * @param {Object} org - Organization object
   * @returns {boolean} Whether the organization has subsites
   */
  hasSubsites(org) {
    return (org.productGroups && org.productGroups.length > 0) || 
           (org.subsites && org.subsites.length > 0);
  }

  /**
   * Helper function to get total subsite/tenant count
   * @param {Object} org - Organization object
   * @returns {number} Total count of tenants/subsites
   */
  getTotalCount(org) {
    if (org.productGroups && org.productGroups.length > 0) {
      return org.productGroups.reduce((sum, group) => sum + group.tenants.length, 0);
    } else if (org.subsites && org.subsites.length > 0) {
      return org.subsites.length;
    }
    return 0;
  }

  /**
   * Creates a DOM element for an organization item
   * @param {Object} org - Organization object
   * @param {boolean} isCurrent - Whether this is the current organization
   * @returns {HTMLElement} Organization list item element
   */
  createOrganizationElement(org, isCurrent) {
    // Create list item
    const li = document.createElement('li');
    li.className = 'org-item';
    if (this.hasSubsites(org)) {
      li.className += ' has-subsites';
    }
    li.dataset.url = org.url;
    li.dataset.orgId = org.id;

    // Create header container
    const headerDiv = document.createElement('div');
    headerDiv.className = 'org-header';

    // Add expand icon if org has subsites
    if (this.hasSubsites(org)) {
      const expandSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      expandSvg.setAttribute('class', 'expand-icon');
      expandSvg.setAttribute('viewBox', '0 0 24 24');
      
      const expandPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      expandPath.setAttribute('d', 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z');
      expandSvg.appendChild(expandPath);
      headerDiv.appendChild(expandSvg);
    } else {
      // Add spacer for alignment when no expand icon
      const spacer = document.createElement('div');
      spacer.className = 'spacer';
      headerDiv.appendChild(spacer);
    }

    // Create organization icon
    const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('class', 'org-icon');
    iconSvg.setAttribute('viewBox', '0 0 24 24');
    
    const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    iconPath.setAttribute('d', 'M18,15H16V17H18M18,11H16V13H18M20,19H12V17H14V15H12V13H14V11H12V9H20M10,7H8V5H10M10,11H8V9H10M10,15H8V13H10M10,19H8V17H10M6,7H4V5H6M6,11H4V9H6M6,15H4V13H6M6,19H4V17H6M12,7V3H2V21H22V7H12Z');
    iconSvg.appendChild(iconPath);
    headerDiv.appendChild(iconSvg);

    // Create content container
    const contentDiv = document.createElement('div');
    contentDiv.className = 'org-content';

    // Create name container with edit functionality
    const nameDiv = document.createElement('div');
    nameDiv.className = 'org-name';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = org.customName ? 'name-text custom' : 'name-text';
    const displayName = SecurityUtils.decodeHtmlEntities(org.customName || org.name);
    nameSpan.textContent = displayName;
    nameSpan.title = displayName; // Add tooltip for full name
    nameDiv.appendChild(nameSpan);
    
    // Add edit icon
    const editIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    editIcon.setAttribute('class', 'edit-icon');
    editIcon.setAttribute('viewBox', '0 0 24 24');
    editIcon.setAttribute('title', 'Edit name');
    
    const editPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    editPath.setAttribute('d', 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z');
    editIcon.appendChild(editPath);
    nameDiv.appendChild(editIcon);
    
    // Add delete icon next to edit icon
    const deleteIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    deleteIcon.setAttribute('class', 'delete-icon');
    deleteIcon.setAttribute('viewBox', '0 0 24 24');
    deleteIcon.setAttribute('title', 'Delete organization');
    deleteIcon.dataset.id = org.id;
    
    const deletePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    deletePath.setAttribute('d', 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z');
    deleteIcon.appendChild(deletePath);
    nameDiv.appendChild(deleteIcon);

    // Add current label if applicable
    if (isCurrent) {
      const currentLabel = document.createElement('span');
      currentLabel.className = 'current-label';
      currentLabel.textContent = 'Current';
      nameDiv.appendChild(document.createTextNode(' '));
      nameDiv.appendChild(currentLabel);
    }

    // Add subsite count if applicable
    if (this.hasSubsites(org)) {
      const subsiteCount = document.createElement('span');
      subsiteCount.className = 'subsite-count';
      const totalCount = this.getTotalCount(org);
      subsiteCount.textContent = `(${totalCount})`;
      nameDiv.appendChild(subsiteCount);
    }

    // Add last updated info if available
    if (false && org.lastUpdated) {
      const metaDiv = document.createElement('div');
      metaDiv.className = 'org-meta';
      metaDiv.className = 'meta-text';
      
      const date = new Date(org.lastUpdated);
      const formattedDate = date.toLocaleDateString(undefined, { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
      });
      metaDiv.textContent = `Updated ${formattedDate}`;
      contentDiv.appendChild(nameDiv);
      contentDiv.appendChild(metaDiv);
    } else {
      contentDiv.appendChild(nameDiv);
    }

    // Assemble the header
    headerDiv.appendChild(contentDiv);

    // Add header to list item
    li.appendChild(headerDiv);

    // Create subsites container if there are subsites
    if (this.hasSubsites(org)) {
      const subsitesContainer = document.createElement('div');
      subsitesContainer.className = 'subsites-container';

      // Handle new grouped format
      if (org.productGroups && org.productGroups.length > 0) {
        org.productGroups.forEach(group => {
          const groupElement = this.createProductGroupElement(group);
          subsitesContainer.appendChild(groupElement);
        });
      } 
      // Handle legacy format
      else if (org.subsites && org.subsites.length > 0) {
        org.subsites.forEach(subsite => {
          const subsiteItem = this.createSubsiteElement(subsite);
          subsitesContainer.appendChild(subsiteItem);
        });
      }

      li.appendChild(subsitesContainer);
    }

    return li;
  }

  /**
   * Creates a DOM element for a product group
   * @param {Object} group - Product group object
   * @returns {HTMLElement} Product group element
   */
  createProductGroupElement(group) {
    const groupContainer = document.createElement('div');
    groupContainer.className = 'product-group collapsed'; // Start collapsed
    groupContainer.dataset.productName = group.productName;

    // Create product header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'product-header';

    // Add expand icon for product group
    const expandSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expandSvg.setAttribute('class', 'product-expand-icon');
    expandSvg.setAttribute('viewBox', '0 0 24 24');
    
    const expandPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    expandPath.setAttribute('d', 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z');
    expandSvg.appendChild(expandPath);
    headerDiv.appendChild(expandSvg);

    // Add product icon
    if (group.iconSrc) {
      if (group.iconSrc.startsWith('http')) {
        const img = document.createElement('img');
        img.className = 'product-icon';
        img.src = group.iconSrc;
        img.alt = group.productName;
        headerDiv.appendChild(img);
      } else {
        // Fallback for non-URL icons
        const iconDiv = document.createElement('div');
        iconDiv.className = 'product-icon';
        iconDiv.textContent = '📄';
        headerDiv.appendChild(iconDiv);
      }
    }

    // Add product name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'product-name';
    nameSpan.textContent = SecurityUtils.decodeHtmlEntities(group.productName);
    headerDiv.appendChild(nameSpan);

    // Add tenant count
    const countSpan = document.createElement('span');
    countSpan.className = 'tenant-count';
    countSpan.textContent = `(${group.tenants.length})`;
    headerDiv.appendChild(countSpan);

    groupContainer.appendChild(headerDiv);

    // Create tenants list (hidden by default)
    const tenantsList = document.createElement('div');
    tenantsList.className = 'tenants-list';
    tenantsList.classList.add('hidden'); // Hidden by default

    group.tenants.forEach(tenant => {
      const tenantElement = this.createTenantElement(tenant);
      tenantsList.appendChild(tenantElement);
    });

    groupContainer.appendChild(tenantsList);

    return groupContainer;
  }

  /**
   * Creates a DOM element for a tenant within a product group
   * @param {Object} tenant - Tenant object
   * @returns {HTMLElement} Tenant element
   */
  createTenantElement(tenant) {
    const div = document.createElement('div');
    div.className = 'tenant-item';
    
    div.dataset.tenantId = tenant.id;

    // Add tenant name with edit functionality
    const nameContainer = document.createElement('div');
    nameContainer.className = 'tenant-name-container';
    nameContainer.dataset.url = tenant.url;
    
    const nameSpan = document.createElement('span');
    nameSpan.className = tenant.customName ? 'tenant-name custom' : 'tenant-name';
    const tenantDisplayName = SecurityUtils.decodeHtmlEntities(tenant.customName || tenant.displayName || tenant.name);
    nameSpan.textContent = tenantDisplayName;
    nameSpan.title = tenantDisplayName; // Add tooltip for full name
    nameContainer.appendChild(nameSpan);
    
    // Add edit icon
    const editIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    editIcon.setAttribute('class', 'edit-icon tenant-edit-icon');
    editIcon.setAttribute('viewBox', '0 0 24 24');
    editIcon.setAttribute('title', 'Edit tenant name');
    
    const editPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    editPath.setAttribute('d', 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z');
    editIcon.appendChild(editPath);
    nameContainer.appendChild(editIcon);
    
    div.appendChild(nameContainer);

    // Add actions if available (excluding the main action which is category "Direct Links")
    if (tenant.actions && tenant.actions.length > 1) {
      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'tenant-actions';
      
      // Filter out the main action (category "Direct Links") and show Quick Actions and Helpful links
      const secondaryActions = tenant.actions.filter(action => 
        action.category === 'Quick Actions'
      );
      
      secondaryActions.forEach(action => {
        if (action.url) {
          try {
            const sanitizedUrl = SecurityUtils.validateAndSanitizeUrl(action.url, {
              allowExternalUrls: true, // Allow external URLs for action links like documentation
              strictMode: true,
              checkMaliciousPatterns: true
            });
            const actionLink = document.createElement('a');
            actionLink.href = sanitizedUrl;
            actionLink.target = '_blank';
            actionLink.className = 'tenant-action-link';
              actionLink.title = SecurityUtils.decodeHtmlEntities(action.name);
            
            // Create icon using first letter of action name
            const icon = document.createElement('span');
            icon.className = 'tenant-action-icon text-icon';
            
            // Always use first letter of action name
            const decodedName = SecurityUtils.decodeHtmlEntities(action.name);
            icon.textContent = decodedName.charAt(0).toUpperCase();
            icon.title = decodedName; // Show full action name in tooltip
            
            actionLink.appendChild(icon);
            actionsContainer.appendChild(actionLink);
          } catch (urlError) {
            this.logger.warn(`Skipping invalid action URL: ${action.url} - ${urlError.message}`, { action });
            // Skip this action if URL validation fails
          }
        }
      });
      
      if (secondaryActions.length > 0) {
        div.appendChild(actionsContainer);
      }
    }

    return div;
  }

  /**
   * Maps MUI icon names to simple Unicode symbols
   * @param {string} iconName - MUI icon name
   * @returns {string} Unicode symbol
   */
  getMuiIconSymbol(iconName) {
    const iconMap = {
      'mdiBookOpenOutline': '📖',
      'mdiBookOpenPageVariantOutline': '📄',
      'mdiChartBoxOutline': '📊',
      'mdiBellCogOutline': '🔔',
      'mdiDatabaseImportOutline': '📂',
      'mdiClipboardFlowOutline': '📋',
      'mdiToolboxOutline': '🛠️',
      'mdiFileEditOutline': '✏️',
      'mdiFileTree': '🌳',
      'mdiFeather': '✒️',
      'mdiListBoxOutline': '📝',
      'mdiTrayArrowDown': '⬇️',
    };
    
    return iconMap[iconName] || iconName.charAt(0).toUpperCase();
  }

  /**
   * Creates a DOM element for a subsite item (legacy format)
   * @param {Object} subsite - Subsite object
   * @returns {HTMLElement} Subsite element
   */
  createSubsiteElement(subsite) {
    const div = document.createElement('div');
    div.className = 'subsite-item';
    div.dataset.url = subsite.url;

    // Add icon based on iconSrc
    if (subsite.iconSrc) {
      // Check if it's a URL or an MDI icon
      if (subsite.iconSrc.startsWith('http')) {
        // It's an image URL
        const img = document.createElement('img');
        img.className = 'subsite-icon';
        img.src = subsite.iconSrc;
        img.alt = subsite.productName || 'Product';
        div.appendChild(img);
      } else if (subsite.iconSrc.startsWith('mdi')) {
        // It's an MDI icon - create a simple representation
        const iconDiv = document.createElement('div');
        iconDiv.className = 'subsite-icon';
        iconDiv.className = 'icon-placeholder';
        iconDiv.textContent = '📄'; // Default icon for MDI
        div.appendChild(iconDiv);
      }
    } else {
      // Default icon
      const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      iconSvg.setAttribute('class', 'subsite-icon');
      iconSvg.setAttribute('viewBox', '0 0 24 24');
      iconSvg.setAttribute('fill', '#6c757d');
      
      const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      iconPath.setAttribute('d', 'M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z');
      iconSvg.appendChild(iconPath);
      div.appendChild(iconSvg);
    }

    // Add formatted name: "[productName]: [displayName]"
    const nameSpan = document.createElement('span');
    nameSpan.className = 'subsite-name';
    
    // Format the display text
    let displayText = '';
    if (subsite.productName) {
      displayText = subsite.productName;
    }
    if (subsite.displayName) {
      displayText += displayText ? `: ${subsite.displayName}` : subsite.displayName;
    }
    if (!displayText) {
      displayText = subsite.name || 'Unnamed';
    }
    
    nameSpan.textContent = displayText;
    div.appendChild(nameSpan);

    return div;
  }

  /**
   * Renders the organizations list in the popup
   */
  renderOrganizations() {
    const listElement = document.getElementById("org-list");
    const emptyStateElement = document.getElementById("empty-state");

    if (!listElement || !emptyStateElement) {
      this.logger.error("Required DOM elements not found");
      return;
    }

    // Clear the list
    listElement.innerHTML = '';

    if (this.organizations.length === 0) {
      listElement.classList.add("hidden");
      emptyStateElement.classList.remove("hidden");
      
      // Show user guidance when no organizations are found
      this.showUserGuidance(
        'No organizations found.',
        'Please visit Sitecore Portal and populate your organizations.',
        'https://portal.sitecorecloud.io/'
      );
      
      return;
    }

    listElement.classList.remove("hidden");
    emptyStateElement.classList.add("hidden");
    
    // Remove any existing guidance messages when organizations are present
    const existingGuidance = document.querySelector('.guidance-container');
    if (existingGuidance) {
      existingGuidance.remove();
    }

    // Sort organizations alphabetically by name
    const sortedOrgs = [...this.organizations].sort((a, b) => 
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );

    // Create and append organization elements
    sortedOrgs.forEach(org => {
      const isCurrent = org.url === this.currentUrl;
      const orgElement = this.createOrganizationElement(org, isCurrent);
      listElement.appendChild(orgElement);
    });

    // Add event listeners
    this.addEventListeners();
  }

  /**
   * Starts editing a name (organization or tenant)
   * @param {HTMLElement} element - The element containing the name
   * @param {string} currentName - The current display name
   * @param {string} originalName - The original name for revert
   * @param {Function} saveCallback - Function to call when saving
   */
  startEdit(element, currentName, originalName, saveCallback) {
    const nameText = element.querySelector('.name-text') || element.querySelector('.tenant-name');
    const editIcon = element.querySelector('.edit-icon');
    
    if (!nameText) return;
    
    // Create input field
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-edit-input';
    input.value = currentName;
    
    // Create control buttons container
    const controls = document.createElement('div');
    controls.className = 'edit-controls';
    
    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.className = 'edit-btn save-btn';
    saveBtn.innerHTML = '✓';
    saveBtn.title = 'Save';
    
    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'edit-btn cancel-btn';
    cancelBtn.innerHTML = '✕';
    cancelBtn.title = 'Cancel';
    
    // Revert button (only show if there's a custom name)
    const revertBtn = document.createElement('button');
    revertBtn.className = 'edit-btn revert-btn';
    revertBtn.innerHTML = '↺';
    revertBtn.title = 'Revert to original';
    if (currentName !== originalName) {
      revertBtn.classList.remove('hidden');
      revertBtn.classList.add('inline-block');
    } else {
      revertBtn.classList.add('hidden');
      revertBtn.classList.remove('inline-block');
    }
    
    controls.appendChild(saveBtn);
    controls.appendChild(cancelBtn);
    controls.appendChild(revertBtn);
    
    // Replace name with input and controls
    nameText.classList.add('hidden');
    editIcon.classList.add('hidden');
    element.appendChild(input);
    element.appendChild(controls);
    
    // Focus and select input
    input.focus();
    input.select();
    
    // Event handlers
    const save = async () => {
      const rawName = input.value.trim();
      
      if (!rawName) {
        // Don't allow empty names
        this.showError('Name cannot be empty');
        return;
      }
      
      try {
        // Validate and sanitize the input
        const sanitizedName = SecurityUtils.validateUserInput(rawName, 'Name', {
          maxLength: SecurityUtils.MAX_LENGTHS.DISPLAY_NAME,
          allowEmpty: false
        });
        
        if (sanitizedName && sanitizedName !== currentName) {
          const result = await saveCallback(sanitizedName);
          if (result !== false) {
            // Update display with new name
            this.endEdit(element, sanitizedName, true);
          }
        } else {
          // No change, just exit edit mode
          this.endEdit(element);
        }
      } catch (validationError) {
        this.showError(`Invalid name: ${validationError.message}`);
        return;
      }
    };
    
    const cancel = () => {
      this.endEdit(element);
    };
    
    const revert = async () => {
      const result = await saveCallback(null); // null means revert to original
      if (result !== false) {
        // Update display with original name
        this.endEdit(element, originalName, false);
      }
    };
    
    // Add event listeners
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      save();
    });
    
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cancel();
    });
    
    revertBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      revert();
    });
    
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        save();
      } else if (e.key === 'Escape') {
        cancel();
      }
    });
    
    // Prevent clicks on input from bubbling up
    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
  
  /**
   * Ends editing mode and restores normal display
   * @param {HTMLElement} element - The element being edited
   * @param {string} newName - The new name to display (optional)
   * @param {boolean} isCustom - Whether this is a custom name
   */
  endEdit(element, newName = null, isCustom = false) {
    const input = element.querySelector('.name-edit-input');
    const controls = element.querySelector('.edit-controls');
    const nameText = element.querySelector('.name-text') || element.querySelector('.tenant-name');
    const editIcon = element.querySelector('.edit-icon');
    
    if (input) input.remove();
    if (controls) controls.remove();
    
    // Update the displayed name if provided
    if (nameText && newName !== null) {
      nameText.textContent = SecurityUtils.decodeHtmlEntities(newName);
      
      // Update the custom class
      if (isCustom) {
        nameText.classList.add('custom');
      } else {
        nameText.classList.remove('custom');
      }
    }
    
    if (nameText) nameText.classList.remove('hidden');
    if (editIcon) editIcon.classList.remove('hidden');
  }

  /**
   * Updates organization custom name
   * @param {string} orgId - Organization ID
   * @param {string} customName - New custom name (null to revert)
   */
  async updateOrganizationName(orgId, customName) {
    try {
      const result = await chrome.storage.local.get(['organizations']);
      const organizations = result.organizations || [];
      
      const orgIndex = organizations.findIndex(org => org.id === orgId);
      if (orgIndex >= 0) {
        if (customName === null) {
          delete organizations[orgIndex].customName;
        } else {
          organizations[orgIndex].customName = customName;
        }
        
        await chrome.storage.local.set({ organizations });
        
        // Update local data without refreshing display
        this.organizations = organizations;
        
        this.showSuccess('Organization name updated');
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error('Error updating organization name', error);
      this.showError('Failed to update organization name');
      return false;
    }
  }

  /**
   * Updates tenant custom name
   * @param {string} orgId - Organization ID
   * @param {string} tenantId - Tenant ID
   * @param {string} customName - New custom name (null to revert)
   */
  async updateTenantName(orgId, tenantId, customName) {
    try {
      const result = await chrome.storage.local.get(['organizations']);
      const organizations = result.organizations || [];
      
      const orgIndex = organizations.findIndex(org => org.id === orgId);
      if (orgIndex >= 0) {
        const org = organizations[orgIndex];
        let updated = false;
        
        // Update in product groups
        if (org.productGroups) {
          for (const group of org.productGroups) {
            const tenant = group.tenants.find(t => t.id === tenantId);
            if (tenant) {
              if (customName === null) {
                delete tenant.customName;
              } else {
                tenant.customName = customName;
              }
              updated = true;
              break;
            }
          }
        }
        
        // Update in legacy subsites
        if (!updated && org.subsites) {
          const subsite = org.subsites.find(s => s.id === tenantId);
          if (subsite) {
            if (customName === null) {
              delete subsite.customName;
            } else {
              subsite.customName = customName;
            }
            updated = true;
          }
        }
        
        if (updated) {
          await chrome.storage.local.set({ organizations });
          
          // Update local data without refreshing display
          this.organizations = organizations;
          
          this.showSuccess('Tenant name updated');
          return true;
        }
      }
      return false;
    } catch (error) {
      this.logger.error('Error updating tenant name', error);
      this.showError('Failed to update tenant name');
      return false;
    }
  }

  /**
   * Adds event listeners to organization items
   */
  addEventListeners() {
    // Handle organization header clicks (expand/collapse)
    document.querySelectorAll(".org-item.has-subsites .org-header").forEach((header) => {
      header.addEventListener("click", async (e) => {
        // Don't expand if delete button was clicked
        if (e.target.closest(".delete-icon")) return;
        
        const orgItem = header.closest(".org-item");
        
        // If clicking on expand icon, toggle expansion
        if (e.target.closest(".expand-icon")) {
          e.stopPropagation();
          orgItem.classList.toggle("expanded");
          return;
        }
        
        // Otherwise, navigate to the organization
        const url = orgItem.dataset.url;
        if (url && this.isValidSitecoreUrl(url)) {
          try {
            await chrome.tabs.create({ url });
            window.close();
          } catch (error) {
            this.logger.error("Error opening tab", error);
            this.showError("Failed to open organization");
          }
        }
      });
    });

    // Handle organization clicks (for orgs without subsites)
    document.querySelectorAll(".org-item:not(.has-subsites)").forEach((item) => {
      item.addEventListener("click", async (e) => {
        // Don't navigate if delete button was clicked
        if (e.target.closest(".delete-icon")) return;

        const url = item.dataset.url;
        if (url && this.isValidSitecoreUrl(url)) {
          try {
            await chrome.tabs.create({ url });
            window.close();
          } catch (error) {
            this.logger.error("Error opening tab", error);
            this.showError("Failed to open organization");
          }
        } else {
          this.showError("Invalid organization URL");
        }
      });
    });

    // Handle subsite clicks (legacy format)
    document.querySelectorAll(".subsite-item").forEach((item) => {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        const url = item.dataset.url;
        if (url && SecurityUtils.isUrlSafeForNavigation(url)) {
          try {
            await chrome.tabs.create({ url });
            window.close();
          } catch (error) {
            this.logger.error("Error opening subsite", error);
            this.showError("Failed to open subsite");
          }
        } else if (url) {
          this.logger.warn("Blocked unsafe URL for subsite navigation", { url });
          this.showError("Invalid or unsafe URL blocked");
        }
      });
    });

    // Handle tenant clicks (new grouped format)
    document.querySelectorAll(".tenant-name-container").forEach((item) => {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        const url = item.dataset.url;
        if (url && SecurityUtils.isUrlSafeForNavigation(url)) {
          try {
            await chrome.tabs.create({ url });
            window.close();
          } catch (error) {
            this.logger.error("Error opening tenant", error);
            this.showError("Failed to open tenant");
          }
        } else if (url) {
          this.logger.warn("Blocked unsafe URL for tenant navigation", { url });
          this.showError("Invalid or unsafe URL blocked");
        }
      });
    });

    // Handle product group header clicks (expand/collapse)
    document.querySelectorAll(".product-header").forEach((header) => {
      header.addEventListener("click", (e) => {
        e.stopPropagation();
        const productGroup = header.closest('.product-group');
        const tenantsList = productGroup.querySelector('.tenants-list');
        
        if (productGroup.classList.contains('collapsed')) {
          // Expand the group
          productGroup.classList.remove('collapsed');
          productGroup.classList.add('expanded');
          tenantsList.classList.remove('hidden');
          tenantsList.classList.add('visible');
        } else {
          // Collapse the group
          productGroup.classList.remove('expanded');
          productGroup.classList.add('collapsed');
          tenantsList.classList.add('hidden');
          tenantsList.classList.remove('visible');
        }
      });
    });

    // Handle delete button clicks
    document.querySelectorAll(".delete-icon").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (id) {
          await this.deleteOrganization(id);
        }
      });
    });

    // Handle organization name edit clicks
    document.querySelectorAll(".org-name .edit-icon").forEach((icon) => {
      icon.addEventListener("click", (e) => {
        e.stopPropagation();
        const orgItem = icon.closest('.org-item');
        const orgId = orgItem.dataset.orgId;
        const nameDiv = icon.closest('.org-name');
        const nameText = nameDiv.querySelector('.name-text');
        const currentName = nameText.textContent;
        
        // Get original name from organizations data
        const org = this.organizations.find(o => o.id === orgId);
        const originalName = org ? org.name : currentName;
        
        this.startEdit(nameDiv, currentName, originalName, async (newName) => {
          await this.updateOrganizationName(orgId, newName);
        });
      });
    });

    // Handle tenant name edit clicks
    document.querySelectorAll(".tenant-edit-icon").forEach((icon) => {
      icon.addEventListener("click", (e) => {
        e.stopPropagation();
        const tenantItem = icon.closest('.tenant-item');
        const orgItem = icon.closest('.org-item');
        const tenantId = tenantItem.dataset.tenantId;
        const orgId = orgItem.dataset.orgId;
        const nameContainer = icon.closest('.tenant-name-container');
        const nameText = nameContainer.querySelector('.tenant-name');
        const currentName = nameText.textContent;
        
        // Get original name from organizations data
        let originalName = currentName;
        const org = this.organizations.find(o => o.id === orgId);
        if (org && org.productGroups) {
          for (const group of org.productGroups) {
            const tenant = group.tenants.find(t => t.id === tenantId);
            if (tenant) {
              originalName = tenant.displayName || tenant.name;
              break;
            }
          }
        }
        
        this.startEdit(nameContainer, currentName, originalName, async (newName) => {
          await this.updateTenantName(orgId, tenantId, newName);
        });
      });
    });
  }

  /**
   * Wraps async operations with timeout handling
   * @param {Promise} operation - Promise to wrap
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {string} operationName - Name for error reporting
   * @returns {Promise} Operation result or timeout error
   */
  async withTimeout(operation, timeoutMs, operationName) {
    const timeoutPromise = new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Operation '${operationName}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      
      // Store timeout ID for cleanup
      operation.finally?.(() => clearTimeout(timeoutId));
    });
    
    return Promise.race([operation, timeoutPromise]);
  }

  /**
   * Async version of confirm dialog
   * @param {string} message - Confirmation message
   * @returns {Promise<boolean>} User confirmation
   */
  async asyncConfirm(message) {
    return new Promise((resolve) => {
      // For now, use sync confirm but wrapped in Promise
      // This can be enhanced with a custom modal later
      const result = confirm(message);
      resolve(result);
    });
  }
}

// Animation styles are defined in popup.css

// Global unhandled Promise rejection handler
window.addEventListener('unhandledrejection', async (event) => {
  Logger.error('Unhandled Promise rejection in popup:', event.reason);
  
  if (typeof errorHandler !== 'undefined') {
    event.preventDefault();
    await errorHandler.handleError(event.reason, 'unhandled_promise_rejection', {
      context: 'popup',
      promiseRejection: true
    });
  }
});

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new OrganizationManager();
});