/**
 * Centralized Configuration Management for Sitecore Portal Chrome Extension
 * Contains all constants, URLs, timeouts, and environment-specific settings
 */

class Configuration {
  constructor() {
    this.environment = this.detectEnvironment();
    this.config = this.loadConfiguration();
    this.validateConfiguration();
  }

  /**
   * Detect current environment
   * @returns {string} Environment name
   */
  detectEnvironment() {
    // Default to production
    let env = 'production';
    
    // Check if we're in development mode
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
      const manifest = chrome.runtime.getManifest();
      if (manifest.name && manifest.name.includes('Dev')) {
        env = 'development';
      }
    }
    
    // Check for local development
    if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
      env = 'development';
    }
    
    return env;
  }

  /**
   * Load configuration based on environment
   * @returns {Object} Configuration object
   */
  loadConfiguration() {
    const baseConfig = {
      // API URLs
      API: {
        SITECORE_PORTAL_BASE: 'https://portal.sitecorecloud.io',
        SITECORE_IDENTITY_BASE: 'https://identity.sitecorecloud.io',
        ORGANIZATIONS_ENDPOINT: '/api/identity/v1/user/organizations',
        TENANTS_ENDPOINT: '/api/portal/graphql',
        PORTAL_BASE_URL: 'https://portal.sitecorecloud.io'
      },

      // URLs and Domains
      URLS: {
        PORTAL_HOME: 'https://portal.sitecorecloud.io/',
        IDENTITY_BASE: 'https://identity.sitecorecloud.io',
        SITECORE_DOCS: 'https://doc.sitecore.com',
        SITECORE_DEVELOPERS: 'https://developers.sitecore.com',
        HELP_URL: 'https://wiseman.net.au'
      },

      // Allowed domains for security
      ALLOWED_DOMAINS: [
        'portal.sitecorecloud.io',
        'identity.sitecorecloud.io',
        'doc.sitecore.com',
        'developers.sitecore.com'
      ],

      // Timeouts and Delays (in milliseconds)
      TIMEOUTS: {
        API_REQUEST: 30000,           // 30 seconds
        POPUP_NOTIFICATION: 5000,     // 5 seconds
        MEMORY_CLEANUP: 300000,       // 5 minutes
        STORAGE_CLEANUP: 60000,       // 1 minute
        REQUEST_DEBOUNCE: 500,        // 500ms
        RETRY_DELAY_BASE: 1000,       // 1 second
        MAX_RETRY_DELAY: 10000,       // 10 seconds
        OBSERVER_TIMEOUT: 300000,     // 5 minutes
        EDIT_INPUT_DELAY: 300,        // 300ms for input debounce
        NOTIFICATION_FADE: 300        // 300ms for fade animations
      },

      // Retry and Limit Settings
      LIMITS: {
        MAX_RETRIES: 3,
        MAX_ORGANIZATIONS: 100,
        MAX_TENANTS_PER_ORG: 50,
        MAX_STORAGE_SIZE: 5242880,    // 5MB in bytes
        MAX_ERROR_COUNT: 10,
        MAX_LOG_ENTRIES: 1000,
        CLEANUP_BATCH_SIZE: 10,
        NOTIFICATION_QUEUE_SIZE: 5
      },

      // Storage Keys
      STORAGE: {
        ORGANIZATIONS_KEY: 'organizations',
        SETTINGS_KEY: 'extension_settings',
        ERROR_LOGS_KEY: 'error_logs',
        PERFORMANCE_METRICS_KEY: 'performance_metrics',
        USER_PREFERENCES_KEY: 'user_preferences',
        DATA_EXPIRATION_MS: 86400000,    // 24 hours in milliseconds
        CLEANUP_INTERVAL_MS: 3600000     // 1 hour cleanup interval
      },

      // UI Constants
      UI: {
        ANIMATION_DURATION: 300,
        DEBOUNCE_DELAY: 300,
        SCROLL_THRESHOLD: 100,
        MAX_DISPLAY_NAME_LENGTH: 50,
        MAX_SEARCH_RESULTS: 20
      },

      // Security Settings
      SECURITY: {
        ALLOWED_PROTOCOLS: ['https:'],
        CSP_DIRECTIVES: "script-src 'self'; object-src 'none'; style-src 'self';",
        INPUT_VALIDATION: {
          MAX_STRING_LENGTH: 255,
          ALLOWED_CHARACTERS: /^[a-zA-Z0-9\s\-_.]+$/,
          URL_PATTERN: /^https:\/\/[a-zA-Z0-9\-._]+\.[a-zA-Z]{2,}(\/.*)?$/
        }
      },

      // Feature Flags
      FEATURES: {
        MEMORY_MONITORING: true,
        ERROR_RECOVERY: true,
        PERFORMANCE_TRACKING: true,
        DEBUG_MODE: false,
        ANALYTICS_ENABLED: false,
        AUTO_CLEANUP: true,
        NOTIFICATION_SOUNDS: false
      },

      // Performance Settings
      PERFORMANCE: {
        BATCH_SIZE: 10,
        THROTTLE_DELAY: 100,
        CACHE_TTL: 300000,            // 5 minutes
        PREFETCH_ENABLED: true,
        LAZY_LOADING: true
      },

      // Logging Configuration
      LOGGING: {
        LEVEL: 'INFO',
        MAX_LOG_SIZE: 1048576,        // 1MB
        CONSOLE_OUTPUT: true,
        STORAGE_OUTPUT: false,
        CONTEXT_LOGGING: true
      }
    };

    // Environment-specific overrides
    const environmentConfigs = {
      development: {
        TIMEOUTS: {
          ...baseConfig.TIMEOUTS,
          API_REQUEST: 10000,          // Shorter timeout for dev
          POPUP_NOTIFICATION: 3000
        },
        FEATURES: {
          ...baseConfig.FEATURES,
          DEBUG_MODE: true,
          ANALYTICS_ENABLED: false
        },
        LOGGING: {
          ...baseConfig.LOGGING,
          LEVEL: 'DEBUG',
          CONSOLE_OUTPUT: true,
          STORAGE_OUTPUT: true
        },
        LIMITS: {
          ...baseConfig.LIMITS,
          MAX_RETRIES: 1,              // Fail fast in development
          MAX_ERROR_COUNT: 5
        }
      },
      staging: {
        FEATURES: {
          ...baseConfig.FEATURES,
          DEBUG_MODE: true,
          ANALYTICS_ENABLED: true
        },
        LOGGING: {
          ...baseConfig.LOGGING,
          LEVEL: 'DEBUG'
        }
      },
      production: {
        FEATURES: {
          ...baseConfig.FEATURES,
          DEBUG_MODE: false,
          ANALYTICS_ENABLED: true
        },
        LOGGING: {
          ...baseConfig.LOGGING,
          LEVEL: 'WARN',
          CONSOLE_OUTPUT: false
        }
      }
    };

    // Merge base config with environment-specific overrides
    const envConfig = environmentConfigs[this.environment] || {};
    return this.deepMerge(baseConfig, envConfig);
  }

  /**
   * Deep merge configuration objects
   * @param {Object} target 
   * @param {Object} source 
   * @returns {Object}
   */
  deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  /**
   * Validate configuration values
   */
  validateConfiguration() {
    const errors = [];

    // Validate required URLs
    if (!this.config.API?.SITECORE_PORTAL_BASE) {
      errors.push('Missing Sitecore Portal base URL');
    }

    // Validate timeouts are positive numbers
    for (const [key, value] of Object.entries(this.config.TIMEOUTS || {})) {
      if (typeof value !== 'number' || value <= 0) {
        errors.push(`Invalid timeout value for ${key}: ${value}`);
      }
    }

    // Validate limits
    for (const [key, value] of Object.entries(this.config.LIMITS || {})) {
      if (typeof value !== 'number' || value < 0) {
        errors.push(`Invalid limit value for ${key}: ${value}`);
      }
    }

    // Validate storage keys are non-empty strings (skip numeric values like expiration times)
    for (const [key, value] of Object.entries(this.config.STORAGE || {})) {
      // Allow both strings and numbers in STORAGE config
      if (typeof value === 'string' && value.length === 0) {
        errors.push(`Invalid storage key for ${key}: ${value}`);
      } else if (typeof value !== 'string' && typeof value !== 'number') {
        errors.push(`Invalid storage value type for ${key}: ${typeof value}`);
      }
    }

    if (errors.length > 0) {
      console.error('Configuration validation failed:', errors);
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }
  }

  /**
   * Get configuration value by path
   * @param {string} path - Dot-separated path (e.g., 'TIMEOUTS.API_REQUEST')
   * @param {*} defaultValue - Default value if path not found
   * @returns {*} Configuration value
   */
  get(path, defaultValue = null) {
    const keys = path.split('.');
    let current = this.config;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return defaultValue;
      }
    }
    
    return current;
  }

  /**
   * Set configuration value by path (for runtime updates)
   * @param {string} path - Dot-separated path
   * @param {*} value - Value to set
   */
  set(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    let current = this.config;
    
    for (const key of keys) {
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[lastKey] = value;
  }

  /**
   * Get environment name
   * @returns {string}
   */
  getEnvironment() {
    return this.environment;
  }

  /**
   * Check if feature is enabled
   * @param {string} featureName 
   * @returns {boolean}
   */
  isFeatureEnabled(featureName) {
    return this.get(`FEATURES.${featureName}`, false);
  }

  /**
   * Get all API URLs
   * @returns {Object}
   */
  getApiUrls() {
    return this.get('API', {});
  }

  /**
   * Get all timeout values
   * @returns {Object}
   */
  getTimeouts() {
    return this.get('TIMEOUTS', {});
  }

  /**
   * Get all limits
   * @returns {Object}
   */
  getLimits() {
    return this.get('LIMITS', {});
  }

  /**
   * Get storage keys
   * @returns {Object}
   */
  getStorageKeys() {
    return this.get('STORAGE', {});
  }

  /**
   * Get allowed domains for security validation
   * @returns {Array}
   */
  getAllowedDomains() {
    return this.get('ALLOWED_DOMAINS', []);
  }

  /**
   * Get current configuration as JSON (for debugging)
   * @returns {string}
   */
  toJSON() {
    return JSON.stringify({
      environment: this.environment,
      config: this.config
    }, null, 2);
  }

  /**
   * Export configuration for external use
   * @returns {Object}
   */
  export() {
    return {
      ...this.config,
      environment: this.environment
    };
  }
}

// Create configuration instance
const configInstance = new Configuration();

// Legacy compatibility - create simple object with commonly used values
const legacyConfig = {
  STORAGE_KEY: configInstance.get('STORAGE.ORGANIZATIONS_KEY'),
  ERROR_DISPLAY_DURATION: configInstance.get('TIMEOUTS.POPUP_NOTIFICATION'),
  POPUP_ANIMATION_DELAY: configInstance.get('UI.ANIMATION_DURATION'),
  API_TIMEOUT: configInstance.get('TIMEOUTS.API_REQUEST'),
  MAX_RETRIES: configInstance.get('LIMITS.MAX_RETRIES'),
  PORTAL_URL: configInstance.get('API.SITECORE_PORTAL_BASE'),
  IDENTITY_URL: configInstance.get('API.SITECORE_IDENTITY_BASE')
};

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Configuration, CONFIG: configInstance, LEGACY_CONFIG: legacyConfig };
}

// Make available globally - use safe assignment to avoid redeclaration
if (typeof window !== 'undefined') {
  if (typeof window.CONFIG === 'undefined') {
    window.CONFIG = configInstance;
  }
  if (typeof window.LEGACY_CONFIG === 'undefined') {
    window.LEGACY_CONFIG = legacyConfig;
  }
} else if (typeof global !== 'undefined') {
  // For service worker/node context
  if (typeof global.CONFIG === 'undefined') {
    global.CONFIG = configInstance;
  }
} else {
  // Fallback - direct global assignment
  if (typeof CONFIG === 'undefined') {
    var CONFIG = configInstance;
  }
}