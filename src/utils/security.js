/**
 * Security utilities for input validation, sanitization, and data protection
 * 
 * @fileOverview Provides comprehensive security functions for the Sitecore Portal extension
 * @author Sitecore Portal Extension
 * @version 1.0.0
 */

/**
 * Security utility class for input validation and sanitization
 */
class SecurityUtils {
  
  /**
   * Allowed URL patterns for Sitecore services
   */
  static ALLOWED_URL_PATTERNS = [
    // All Sitecore cloud domains (with or without subdomains)
    // Updated to handle URLs with or without paths (e.g., query params only)
    /^https:\/\/([a-zA-Z0-9\-]+\.)*sitecorecloud\.io($|\/.*$|\?.*$)$/,
    /^https:\/\/([a-zA-Z0-9\-]+\.)*sitecorecontenthub\.cloud($|\/.*$|\?.*$)$/,
    /^https:\/\/([a-zA-Z0-9\-]+\.)*sitecore\.cloud($|\/.*$|\?.*$)$/,
    /^https:\/\/([a-zA-Z0-9\-]+\.)*sitecorecommerce\.cloud($|\/.*$|\?.*$)$/,
    /^https:\/\/([a-zA-Z0-9\-]+\.)*stylelabs\.cloud($|\/.*$|\?.*$)$/,
    /^https:\/\/([a-zA-Z0-9\-]+\.)*stylelabs\.io($|\/.*$|\?.*$)$/,
    /^https:\/\/([a-zA-Z0-9\-]+\.)*sitecore\.com($|\/.*$|\?.*$)$/,
    /^https:\/\/([a-zA-Z0-9\-]+\.)*ordercloud\.io($|\/.*$|\?.*$)$/,
    /^https:\/\/npmjs\.com($|\/.*$|\?.*$)$/,
    /^https:\/\/www\.npmjs\.com($|\/.*$|\?.*$)$/
  ];

  /**
   * URLs that are legitimate external links and should not generate warnings
   * These are known safe external resources used in Sitecore actions
   */
  static URL_WARNING_EXCLUSIONS = [
    // NPM packages and documentation
    'https://www.npmjs.com/package/@sitecore-search/react',
    'https://npmjs.com/package/@sitecore-search/react',
    
    // Sitecore documentation
    'https://doc.sitecore.com/search',
    'https://doc.sitecore.com/xmc',
    'https://developers.sitecore.com/downloads/Sitecore_Stream_for_Platform_DXP',
    
    // Add more external URLs here as needed
    // Format: exact URL strings that should not generate warnings
  ];

  /**
   * Maximum allowed string lengths
   */
  static MAX_LENGTHS = {
    ORGANIZATION_NAME: 200,
    DISPLAY_NAME: 250,
    DESCRIPTION: 1000,
    URL: 2048,
    ID: 100,
    ACTION_NAME: 100
  };

  /**
   * Regex patterns for validation
   */
  static PATTERNS = {
    ORGANIZATION_ID: /^org_[a-zA-Z0-9]{16}$/,
    TENANT_ID: /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/,
    ACCOUNT_ID: /^[a-zA-Z0-9_]{10,30}$/,
    SAFE_NAME: /^[a-zA-Z0-9\s\-_.,()&'/]+$/
  };

  /**
   * HTML entities for escaping
   */
  static HTML_ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };

  /**
   * Validates and sanitizes organization data
   * @param {Object} org - Organization object to validate
   * @returns {Object} Sanitized organization object
   * @throws {Error} If validation fails
   */
  static validateOrganizationData(org) {
    if (!org || typeof org !== 'object') {
      throw new Error('Invalid organization data: must be an object');
    }

    const sanitized = {};

    // Validate and sanitize ID
    if (org.id) {
      if (typeof org.id !== 'string') {
        throw new Error('Organization ID must be a string');
      }
      if (!this.PATTERNS.ORGANIZATION_ID.test(org.id)) {
        throw new Error('Invalid organization ID format');
      }
      sanitized.id = this.sanitizeString(org.id);
    }

    // Validate and sanitize name
    if (org.name) {
      sanitized.name = this.validateAndSanitizeName(org.name, 'Organization name');
    }

    // Validate and sanitize display name
    if (org.displayName) {
      sanitized.displayName = this.validateAndSanitizeName(org.displayName, 'Display name');
    }

    // Validate and sanitize custom name
    if (org.customName) {
      sanitized.customName = this.validateAndSanitizeName(org.customName, 'Custom name');
    }

    // Validate URL
    if (org.url) {
      sanitized.url = this.validateAndSanitizeUrl(org.url);
    }

    // Validate and sanitize other string fields
    ['originalName', 'type', 'region', 'accountId'].forEach(field => {
      if (org[field] !== undefined) {
        sanitized[field] = this.sanitizeString(org[field]);
      }
    });

    // Copy safe non-string fields
    ['mfaRequired', 'lastUpdated', 'lastSubsiteUpdate'].forEach(field => {
      if (org[field] !== undefined) {
        sanitized[field] = org[field];
      }
    });

    // Recursively validate product groups
    if (org.productGroups && Array.isArray(org.productGroups)) {
      sanitized.productGroups = org.productGroups.map(group => 
        this.validateProductGroup(group)
      );
    }

    // Recursively validate subsites (legacy)
    if (org.subsites && Array.isArray(org.subsites)) {
      sanitized.subsites = org.subsites.map(subsite => 
        this.validateSubsiteData(subsite)
      );
    }

    return sanitized;
  }

  /**
   * Validates and sanitizes product group data
   * @param {Object} group - Product group to validate
   * @returns {Object} Sanitized product group
   */
  static validateProductGroup(group) {
    if (!group || typeof group !== 'object') {
      throw new Error('Invalid product group data');
    }

    const sanitized = {
      productName: this.validateAndSanitizeName(group.productName || '', 'Product name'),
      iconSrc: group.iconSrc ? this.validateAndSanitizeUrl(group.iconSrc) : '',
      tenants: []
    };

    if (group.tenants && Array.isArray(group.tenants)) {
      sanitized.tenants = group.tenants.map(tenant => 
        this.validateTenantData(tenant)
      );
    }

    return sanitized;
  }

  /**
   * Validates and sanitizes tenant data
   * @param {Object} tenant - Tenant object to validate
   * @returns {Object} Sanitized tenant object
   */
  static validateTenantData(tenant) {
    if (!tenant || typeof tenant !== 'object') {
      throw new Error('Invalid tenant data');
    }

    const sanitized = {};

    // Validate tenant ID
    if (tenant.id) {
      if (!this.PATTERNS.TENANT_ID.test(tenant.id)) {
        throw new Error('Invalid tenant ID format');
      }
      sanitized.id = tenant.id;
    }

    // Validate and sanitize names
    if (tenant.name) {
      sanitized.name = this.validateAndSanitizeName(tenant.name, 'Tenant name');
    }
    if (tenant.displayName) {
      sanitized.displayName = this.validateAndSanitizeName(tenant.displayName, 'Tenant display name');
    }
    if (tenant.customName) {
      sanitized.customName = this.validateAndSanitizeName(tenant.customName, 'Tenant custom name');
    }

    // Validate URL (skip empty/falsy URLs, log invalid URLs but don't fail)
    if (tenant.url && tenant.url.trim() !== '') {
      try {
        sanitized.url = this.validateAndSanitizeUrl(tenant.url);
      } catch (urlError) {
        // Check if URL is in the exclusion list - don't warn for known safe external URLs
        const isExcluded = this.URL_WARNING_EXCLUSIONS.includes(tenant.url);
        if (!isExcluded) {
          Logger.warn(`Invalid tenant URL, skipping: ${tenant.url} - ${urlError.message}`, { tenant }, 'SecurityUtils');
        }
        // Skip the URL but continue with the tenant validation
        sanitized.url = null;
      }
    }

    // Validate organization ID reference
    if (tenant.organizationId && !this.PATTERNS.ORGANIZATION_ID.test(tenant.organizationId)) {
      throw new Error('Invalid organization ID in tenant data');
    }
    sanitized.organizationId = tenant.organizationId;

    // Validate actions
    if (tenant.actions && Array.isArray(tenant.actions)) {
      sanitized.actions = tenant.actions.map(action => this.validateActionData(action));
    }

    return sanitized;
  }

  /**
   * Validates and sanitizes subsite data (legacy format)
   * @param {Object} subsite - Subsite object to validate
   * @returns {Object} Sanitized subsite object
   */
  static validateSubsiteData(subsite) {
    if (!subsite || typeof subsite !== 'object') {
      throw new Error('Invalid subsite data');
    }

    return {
      id: this.sanitizeString(subsite.id || ''),
      name: this.validateAndSanitizeName(subsite.name || '', 'Subsite name'),
      displayName: this.validateAndSanitizeName(subsite.displayName || '', 'Subsite display name'),
      url: subsite.url ? this.validateAndSanitizeUrl(subsite.url) : '',
      customName: subsite.customName ? this.validateAndSanitizeName(subsite.customName, 'Subsite custom name') : undefined
    };
  }

  /**
   * Validates and sanitizes action data
   * @param {Object} action - Action object to validate
   * @returns {Object} Sanitized action object
   */
  static validateActionData(action) {
    if (!action || typeof action !== 'object') {
      throw new Error('Invalid action data');
    }

    const sanitized = {
      name: this.validateAndSanitizeName(action.name || '', 'Action name', this.MAX_LENGTHS.ACTION_NAME),
      displayName: action.displayName ? this.validateAndSanitizeName(action.displayName, 'Action display name', this.MAX_LENGTHS.ACTION_NAME) : null,
      category: this.sanitizeString(action.category || ''),
      description: this.sanitizeString(action.description || '').substring(0, this.MAX_LENGTHS.DESCRIPTION)
    };

    if (action.url) {
      try {
        sanitized.url = this.validateAndSanitizeUrl(action.url);
      } catch (urlError) {
        // Check if URL is in the exclusion list - don't warn for known safe external URLs
        const isExcluded = this.URL_WARNING_EXCLUSIONS.includes(action.url);
        if (!isExcluded) {
          Logger.warn(`Invalid action URL, skipping: ${action.url} - ${urlError.message}`, { action }, 'SecurityUtils');
        }
        // Skip the URL but continue with the action validation
        sanitized.url = null;
      }
    }
    
    return sanitized;
  }

  /**
   * Validates and sanitizes a name field
   * @param {string} name - Name to validate
   * @param {string} fieldName - Field name for error messages
   * @param {number} maxLength - Maximum allowed length
   * @returns {string} Sanitized name
   */
  static validateAndSanitizeName(name, fieldName = 'Name', maxLength = this.MAX_LENGTHS.DISPLAY_NAME) {
    if (typeof name !== 'string') {
      throw new Error(`${fieldName} must be a string`);
    }

    const trimmed = name.trim();
    
    if (trimmed.length === 0) {
      throw new Error(`${fieldName} cannot be empty`);
    }
    
    if (trimmed.length > maxLength) {
      throw new Error(`${fieldName} too long (max ${maxLength} characters)`);
    }

    // Check for safe characters only
    if (!this.PATTERNS.SAFE_NAME.test(trimmed)) {
      throw new Error(`${fieldName} contains invalid characters`);
    }

    return this.sanitizeString(trimmed);
  }

  /**
   * Known malicious URL patterns and suspicious indicators
   */
  static MALICIOUS_URL_PATTERNS = [
    // IP addresses instead of domain names
    /^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}/,
    
    // Suspicious URL shorteners (not comprehensive, but common ones)
    /^https?:\/\/(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|short\.link|rb\.gy)/,
    
    // URL encoding to hide malicious content
    /%[0-9a-f]{2}/i,
    
    // Suspicious Unicode characters that could be used in homograph attacks
    /[\u0430-\u044f\u0410-\u042f]/, // Cyrillic characters
    /[\u4e00-\u9fff]/, // Chinese characters
    /[\u0600-\u06ff]/, // Arabic characters
    
    // Double encoding attempts
    /%25[0-9a-f]{2}/i,
    
    // Common phishing indicators
    /(?:secure|verify|update|confirm|account|login|signin)[.-](?!sitecorecloud\.io)/i,
    
    // Suspicious TLDs (commonly used for phishing)
    /\.(?:tk|ml|ga|cf|top|click|download|work|men|kim|loan|racing|review|accountant|science|party|bid|trade|webcam|win|date|stream|gq|gdn|mom)(?:\/|$)/i,
    
    // Suspicious subdomains with security-related terms (but exclude legitimate sitecore domains)
    // This checks for suspicious patterns but will be overridden by domain whitelist validation
    /(?:phishing|malware|virus|trojan)[.-]/i
  ];

  /**
   * Known safe external domains that extension explicitly allows
   */
  static SAFE_EXTERNAL_DOMAINS = [
    'npmjs.com',
    'www.npmjs.com',
    'doc.sitecore.com',
    'developers.sitecore.com',
    'github.com',
    'docs.microsoft.com'
  ];

  /**
   * Enhanced URL validation with strict security checks
   * @param {string} url - URL to validate
   * @param {Object} options - Validation options
   * @returns {string} Sanitized URL
   */
  static validateAndSanitizeUrl(url, options = {}) {
    const {
      allowExternalUrls = false,
      strictMode = true,
      checkMaliciousPatterns = true
    } = options;

    if (typeof url !== 'string') {
      throw new Error('URL must be a string');
    }

    let trimmed = url.trim();
    
    if (trimmed.length === 0) {
      throw new Error('URL cannot be empty');
    }
    
    // Pre-validation sanitization
    trimmed = this.sanitizeUrlForValidation(trimmed);
    
    if (trimmed.length > this.MAX_LENGTHS.URL) {
      throw new Error(`URL too long (max ${this.MAX_LENGTHS.URL} characters)`);
    }

    // Parse URL with comprehensive error handling
    let parsedUrl;
    try {
      parsedUrl = new URL(trimmed);
    } catch (error) {
      throw new Error(`Invalid URL format: ${trimmed}`);
    }

    // Enhanced protocol validation
    if (!this.isValidProtocol(parsedUrl.protocol, strictMode)) {
      throw new Error(`Invalid protocol: ${parsedUrl.protocol}. Only HTTPS is allowed.`);
    }

    // Check URL exclusion list first (bypasses all other checks)
    if (this.URL_WARNING_EXCLUSIONS.includes(trimmed)) {
      return trimmed;
    }

    // Enhanced hostname validation
    this.validateHostname(parsedUrl.hostname, trimmed);

    // Enhanced domain validation (do this before malicious pattern check)
    if (!this.isValidDomain(parsedUrl, trimmed, allowExternalUrls)) {
      throw new Error(`URL domain not authorized: ${parsedUrl.hostname}`);
    }

    // Malicious pattern detection (only after domain validation)
    if (checkMaliciousPatterns && this.containsMaliciousPatterns(trimmed)) {
      throw new Error(`URL contains suspicious patterns and has been blocked: ${parsedUrl.hostname}`);
    }

    // Additional security checks
    this.performSecurityChecks(parsedUrl, trimmed);

    return trimmed;
  }

  /**
   * Sanitizes URL for validation by removing dangerous encodings
   * @param {string} url - URL to sanitize
   * @returns {string} Sanitized URL
   */
  static sanitizeUrlForValidation(url) {
    // Decode HTML entities that might have been applied earlier
    if (url.includes('&#x') || url.includes('&amp;') || url.includes('&lt;') || url.includes('&gt;')) {
      url = url
        .replace(/&#x2F;/g, '/')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'");
    }

    // Normalize multiple slashes in path
    url = url.replace(/([^:]\/)\/+/g, '$1');

    // Remove dangerous null bytes and control characters
    url = url.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

    return url;
  }

  /**
   * Validates URL protocol
   * @param {string} protocol - Protocol to validate
   * @param {boolean} strictMode - Whether to enforce strict HTTPS-only
   * @returns {boolean} True if protocol is valid
   */
  static isValidProtocol(protocol, strictMode = true) {
    if (strictMode) {
      return protocol === 'https:';
    }
    return protocol === 'https:' || protocol === 'http:';
  }

  /**
   * Enhanced hostname validation
   * @param {string} hostname - Hostname to validate
   * @param {string} fullUrl - Full URL for error reporting
   */
  static validateHostname(hostname, fullUrl) {
    // Check for empty or malformed hostname
    if (!hostname || hostname.length === 0) {
      throw new Error(`Invalid hostname in URL: ${fullUrl}`);
    }

    // Check for localhost or private IP ranges (potential security risk)
    if (this.isLocalOrPrivateAddress(hostname)) {
      throw new Error(`Access to local/private addresses is not allowed: ${hostname}`);
    }

    // Check for overly long hostnames (potential buffer overflow attempts)
    if (hostname.length > 253) {
      throw new Error(`Hostname too long: ${hostname}`);
    }

    // Validate hostname format (basic DNS validation)
    if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) {
      throw new Error(`Invalid characters in hostname: ${hostname}`);
    }

    // Check for suspicious double dots or malformed domains
    if (hostname.includes('..') || hostname.startsWith('.') || hostname.endsWith('.')) {
      throw new Error(`Malformed hostname: ${hostname}`);
    }
  }

  /**
   * Checks if hostname is localhost or private IP range
   * @param {string} hostname - Hostname to check
   * @returns {boolean} True if local/private
   */
  static isLocalOrPrivateAddress(hostname) {
    // Localhost patterns
    if (/^(localhost|127\.|::1|0\.0\.0\.0)/.test(hostname)) {
      return true;
    }

    // Private IP ranges
    const privateRanges = [
      /^10\./,                    // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
      /^192\.168\./,              // 192.168.0.0/16
      /^169\.254\./,              // Link-local
      /^fc[0-9a-f]{2}:/i,         // IPv6 private
      /^fe[89ab][0-9a-f]:/i       // IPv6 link-local
    ];

    return privateRanges.some(pattern => pattern.test(hostname));
  }

  /**
   * Enhanced domain validation
   * @param {URL} parsedUrl - Parsed URL object
   * @param {string} fullUrl - Full URL string
   * @param {boolean} allowExternalUrls - Whether to allow external URLs
   * @returns {boolean} True if domain is valid
   */
  static isValidDomain(parsedUrl, fullUrl, allowExternalUrls) {
    const hostname = parsedUrl.hostname;

    // Check against allowed Sitecore patterns
    const isSitecoreAllowed = this.ALLOWED_URL_PATTERNS.some(pattern => 
      pattern.test(fullUrl)
    );
    
    if (isSitecoreAllowed) {
      return true;
    }

    // If external URLs are allowed, check safe external domains
    if (allowExternalUrls) {
      const isSafeExternal = this.SAFE_EXTERNAL_DOMAINS.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
      );
      
      if (isSafeExternal) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks for malicious URL patterns
   * @param {string} url - URL to check
   * @returns {boolean} True if malicious patterns found
   */
  static containsMaliciousPatterns(url) {
    return this.MALICIOUS_URL_PATTERNS.some(pattern => pattern.test(url));
  }

  /**
   * Performs additional security checks on parsed URL
   * @param {URL} parsedUrl - Parsed URL object
   * @param {string} fullUrl - Full URL string
   */
  static performSecurityChecks(parsedUrl, fullUrl) {
    // Check for suspicious port numbers
    if (parsedUrl.port && !this.isAllowedPort(parsedUrl.port)) {
      throw new Error(`Suspicious port number: ${parsedUrl.port}`);
    }

    // Check for overly complex URLs (potential obfuscation)
    if (fullUrl.length > 500 || (fullUrl.match(/[?&]/g) || []).length > 20) {
      throw new Error('URL is too complex and may be malicious');
    }

    // Check for suspicious path patterns
    if (this.hasSuspiciousPath(parsedUrl.pathname)) {
      throw new Error(`Suspicious URL path detected: ${parsedUrl.pathname}`);
    }
  }

  /**
   * Checks if port number is allowed
   * @param {string} port - Port number
   * @returns {boolean} True if port is allowed
   */
  static isAllowedPort(port) {
    const allowedPorts = ['80', '443', '8080', '8443']; // Common web ports
    return allowedPorts.includes(port);
  }

  /**
   * Checks for suspicious path patterns
   * @param {string} pathname - URL pathname
   * @returns {boolean} True if path is suspicious
   */
  static hasSuspiciousPath(pathname) {
    const suspiciousPatterns = [
      /\.\.\//, // Directory traversal
      /\/etc\//, // System file access
      /\/proc\//, // Process information
      /\/var\//, // Variable data
      /\\x[0-9a-f]{2}/i, // Hex encoding
      /%c[01]%/i, // Unicode bypass attempts
      /script[^a-z]/i, // Script injection attempts
      /javascript:/i, // JavaScript protocol
      /data:/i, // Data URLs
      /vbscript:/i // VBScript protocol
    ];

    return suspiciousPatterns.some(pattern => pattern.test(pathname));
  }

  /**
   * Validates URL for navigation (stricter than storage validation)
   * @param {string} url - URL to validate for navigation
   * @returns {boolean} True if safe for navigation
   */
  static isUrlSafeForNavigation(url) {
    try {
      this.validateAndSanitizeUrl(url, {
        allowExternalUrls: false,
        strictMode: true,
        checkMaliciousPatterns: true
      });
      return true;
    } catch (error) {
      console.warn('URL validation failed for navigation:', error.message);
      return false;
    }
  }

  /**
   * Enhanced Sitecore-specific URL validation for popup navigation
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid Sitecore URL
   */
  static isValidSitecoreUrl(url) {
    try {
      const parsed = new URL(url);
      
      // Enhanced protocol check
      if (parsed.protocol !== 'https:') {
        return false;
      }

      // Check against all allowed Sitecore domains
      const sitecoreDomains = [
        'portal.sitecorecloud.io',
        'identity.sitecorecloud.io',
        'mobiledev.sitecorecloud.io',
        'xmcentral.sitecorecloud.io',
        'edge.sitecorecloud.io'
      ];

      const isValidDomain = sitecoreDomains.some(domain => 
        parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
      );

      if (!isValidDomain) {
        return false;
      }

      // Check for suspicious patterns
      if (this.containsMaliciousPatterns(url)) {
        return false;
      }

      // Additional security checks
      this.performSecurityChecks(parsed, url);

      return true;
    } catch (error) {
      console.warn('Sitecore URL validation failed:', error.message);
      return false;
    }
  }

  /**
   * Decodes HTML entities in a string for display purposes
   * @param {*} input - Input to decode
   * @returns {string} Decoded string
   */
  static decodeHtmlEntities(input) {
    if (input === null || input === undefined) {
      return '';
    }
    
    const str = String(input);
    
    // Decode common HTML entities
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/');
  }

  /**
   * Sanitizes a string by escaping HTML entities and removing dangerous characters
   * @param {*} input - Input to sanitize
   * @returns {string} Sanitized string
   */
  static sanitizeString(input) {
    if (input === null || input === undefined) {
      return '';
    }
    
    const str = String(input);
    
    // Escape HTML entities
    return str.replace(/[&<>"'\/]/g, (match) => this.HTML_ENTITIES[match] || match);
  }

  /**
   * Validates user input from forms/UI
   * @param {string} input - User input to validate
   * @param {string} fieldName - Field name for errors
   * @param {Object} options - Validation options
   * @returns {string} Sanitized input
   */
  static validateUserInput(input, fieldName = 'Input', options = {}) {
    const {
      maxLength = 200,
      allowEmpty = false,
      pattern = this.PATTERNS.SAFE_NAME
    } = options;

    if (typeof input !== 'string') {
      throw new Error(`${fieldName} must be a string`);
    }

    const trimmed = input.trim();

    if (!allowEmpty && trimmed.length === 0) {
      throw new Error(`${fieldName} cannot be empty`);
    }

    if (trimmed.length > maxLength) {
      throw new Error(`${fieldName} too long (max ${maxLength} characters)`);
    }

    if (trimmed.length > 0 && pattern && !pattern.test(trimmed)) {
      throw new Error(`${fieldName} contains invalid characters`);
    }

    return this.sanitizeString(trimmed);
  }

  /**
   * Validates an array of data objects
   * @param {Array} array - Array to validate
   * @param {Function} itemValidator - Function to validate each item
   * @returns {Array} Array of sanitized items
   */
  static validateArray(array, itemValidator) {
    if (!Array.isArray(array)) {
      return [];
    }

    return array.map((item, index) => {
      try {
        return itemValidator(item);
      } catch (error) {
        throw new Error(`Item ${index}: ${error.message}`);
      }
    });
  }

  /**
   * Creates a validation error with details
   * @param {string} message - Error message
   * @param {string} field - Field that failed validation
   * @param {*} value - Value that failed validation
   * @returns {Error} Validation error
   */
  static createValidationError(message, field, value) {
    const error = new Error(message);
    error.name = 'ValidationError';
    error.field = field;
    error.value = value;
    return error;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SecurityUtils;
} else if (typeof window !== 'undefined') {
  window.SecurityUtils = SecurityUtils;
}