/**
 * Storage Security Manager
 * Handles encryption of sensitive data, data expiration, and secure cleanup
 */

class StorageSecurityManager {
  constructor() {
    // Check if Logger is available
    if (typeof Logger !== 'undefined') {
      this.logger = Logger.createContextLogger('StorageSecurityManager');
    } else {
      // Fallback logger
      this.logger = {
        debug: (...args) => console.log('[StorageSecurityManager]', ...args),
        info: (...args) => console.log('[StorageSecurityManager]', ...args),
        warn: (...args) => console.warn('[StorageSecurityManager]', ...args),
        error: (...args) => console.error('[StorageSecurityManager]', ...args)
      };
    }
    
    // Check if CONFIG is available, otherwise use defaults
    this.config = typeof CONFIG !== 'undefined' ? CONFIG : {
      get: (path, defaultValue) => {
        const defaults = {
          'STORAGE.DATA_EXPIRATION_MS': 86400000,  // 24 hours
          'STORAGE.ORGANIZATIONS_KEY': 'organizations',
          'STORAGE.ENCRYPTION_ENABLED': false  // Disable encryption for now
        };
        return defaults[path] || defaultValue;
      }
    };
    
    this.encryptionKey = null;
    
    // Only initialize encryption if enabled
    if (this.config.get('STORAGE.ENCRYPTION_ENABLED', false)) {
      this.initializeEncryption();
    }
  }

  /**
   * Initialize encryption key for the session
   */
  async initializeEncryption() {
    try {
      // Generate or retrieve session encryption key
      const keyData = await this.getOrCreateEncryptionKey();
      this.encryptionKey = await this.importKey(keyData);
      this.logger.debug('Encryption initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize encryption', error);
      // Fallback to no encryption but log the issue
      this.encryptionKey = null;
    }
  }

  /**
   * Get or create encryption key for this extension
   * @returns {ArrayBuffer} Key data
   */
  async getOrCreateEncryptionKey() {
    try {
      // Try to get existing key from session storage (persists until browser closes)
      const stored = await chrome.storage.session.get(['encryptionKey']);
      if (stored.encryptionKey) {
        // Convert base64 back to ArrayBuffer
        const binaryString = atob(stored.encryptionKey);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
      }
    } catch (error) {
      // Session storage might not be available, fall back to generating new key
      this.logger.debug('Session storage not available for encryption key');
    }
    
    // Generate a new key
    const key = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );
    
    const keyData = await crypto.subtle.exportKey('raw', key);
    
    // Try to store in session storage for this browser session
    try {
      // Convert ArrayBuffer to base64 for storage
      const bytes = new Uint8Array(keyData);
      const binaryString = String.fromCharCode(...bytes);
      const base64Key = btoa(binaryString);
      await chrome.storage.session.set({ encryptionKey: base64Key });
    } catch (error) {
      this.logger.debug('Could not store encryption key in session storage');
    }
    
    return keyData;
  }

  /**
   * Import encryption key from key data
   * @param {ArrayBuffer} keyData - Raw key data
   * @returns {CryptoKey} Imported key
   */
  async importKey(keyData) {
    return await crypto.subtle.importKey(
      'raw',
      keyData,
      {
        name: 'AES-GCM',
        length: 256
      },
      false, // not extractable
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt sensitive data
   * @param {string} data - Data to encrypt
   * @returns {Object} Encrypted data with IV
   */
  async encryptData(data) {
    if (!this.encryptionKey || !data) {
      return { encrypted: false, data: data };
    }

    try {
      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);
      
      // Generate random IV for each encryption
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      const encryptedData = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        this.encryptionKey,
        dataBytes
      );

      // Convert to base64 for storage
      const encryptedBase64 = btoa(String.fromCharCode(...new Uint8Array(encryptedData)));
      const ivBase64 = btoa(String.fromCharCode(...iv));

      return {
        encrypted: true,
        data: encryptedBase64,
        iv: ivBase64,
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.warn('Encryption failed, storing as plaintext', error.message);
      return { encrypted: false, data: data };
    }
  }

  /**
   * Decrypt sensitive data
   * @param {Object|string} encryptedObj - Encrypted data object or plain string
   * @returns {string} Decrypted data
   */
  async decryptData(encryptedObj) {
    // Handle plain strings or non-encrypted data
    if (!encryptedObj || typeof encryptedObj === 'string') {
      return encryptedObj;
    }
    
    // Check if it's actually an encrypted object
    if (!encryptedObj.encrypted || !encryptedObj.data || !encryptedObj.iv) {
      // Not encrypted, return as-is
      return encryptedObj.data || encryptedObj;
    }
    
    // No encryption key available (different session)
    if (!this.encryptionKey) {
      this.logger.debug('No encryption key available, returning encrypted data marker');
      // Return a placeholder to indicate encrypted data from another session
      return '[Encrypted in previous session]';
    }

    try {
      // Validate base64 strings before attempting decode
      if (typeof encryptedObj.data !== 'string' || typeof encryptedObj.iv !== 'string') {
        this.logger.debug('Invalid encrypted data format');
        return encryptedObj.data || '[Invalid encrypted data]';
      }
      
      // Convert from base64
      const encryptedData = new Uint8Array(
        atob(encryptedObj.data).split('').map(char => char.charCodeAt(0))
      );
      const iv = new Uint8Array(
        atob(encryptedObj.iv).split('').map(char => char.charCodeAt(0))
      );

      const decryptedData = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        this.encryptionKey,
        encryptedData
      );

      const decoder = new TextDecoder();
      return decoder.decode(decryptedData);
    } catch (error) {
      // This is expected when data was encrypted with a different key
      this.logger.debug('Cannot decrypt data from different session', error.message);
      return '[Encrypted in previous session]';
    }
  }

  /**
   * Encrypt sensitive fields in organization data
   * @param {Object} organization - Organization object
   * @returns {Object} Organization with encrypted sensitive fields
   */
  async encryptOrganization(organization) {
    if (!organization) return organization;
    
    // Skip encryption if disabled
    if (!this.config.get('STORAGE.ENCRYPTION_ENABLED', false)) {
      return organization;
    }

    const encrypted = { ...organization };
    
    // Fields considered sensitive that should be encrypted
    const sensitiveFields = ['accountId', 'id'];
    
    for (const field of sensitiveFields) {
      if (encrypted[field]) {
        encrypted[field] = await this.encryptData(encrypted[field]);
      }
    }

    // Check for email patterns in names and encrypt if found
    const nameFields = ['name', 'displayName', 'customName', 'originalName'];
    for (const field of nameFields) {
      if (encrypted[field] && this.containsEmail(encrypted[field])) {
        encrypted[field] = await this.encryptData(encrypted[field]);
      }
    }

    // Add expiration timestamp
    encrypted._securityMeta = {
      encrypted: true,
      expiresAt: Date.now() + this.config.get('STORAGE.DATA_EXPIRATION_MS', 86400000),
      encryptedAt: Date.now()
    };

    return encrypted;
  }

  /**
   * Decrypt sensitive fields in organization data
   * @param {Object} organization - Organization with encrypted fields
   * @returns {Object} Organization with decrypted sensitive fields
   */
  async decryptOrganization(organization) {
    if (!organization) return organization;
    
    // If no security metadata or encryption is disabled, return as-is
    if (!organization._securityMeta?.encrypted || !this.config.get('STORAGE.ENCRYPTION_ENABLED', false)) {
      return organization;
    }

    // Check if data has expired
    if (this.isDataExpired(organization)) {
      this.logger.debug('Organization data expired, returning null', { orgId: organization.id });
      return null;
    }

    const decrypted = { ...organization };
    
    // Decrypt sensitive fields
    const sensitiveFields = ['accountId', 'id'];
    for (const field of sensitiveFields) {
      if (decrypted[field] && typeof decrypted[field] === 'object' && decrypted[field].encrypted) {
        decrypted[field] = await this.decryptData(decrypted[field]);
      }
    }

    // Decrypt name fields that were encrypted
    const nameFields = ['name', 'displayName', 'customName', 'originalName'];
    for (const field of nameFields) {
      if (decrypted[field] && typeof decrypted[field] === 'object' && decrypted[field].encrypted) {
        decrypted[field] = await this.decryptData(decrypted[field]);
      }
    }

    // Remove security metadata before returning
    delete decrypted._securityMeta;

    return decrypted;
  }

  /**
   * Check if organization data has expired
   * @param {Object} organization - Organization object
   * @returns {boolean} True if expired
   */
  isDataExpired(organization) {
    if (!organization._securityMeta?.expiresAt) {
      return false; // No expiration set
    }
    
    return Date.now() > organization._securityMeta.expiresAt;
  }

  /**
   * Check if a string contains email patterns
   * @param {string} text - Text to check
   * @returns {boolean} True if contains email
   */
  containsEmail(text) {
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    return emailPattern.test(text);
  }

  /**
   * Process organizations array for encryption
   * @param {Array} organizations - Array of organizations
   * @returns {Array} Array with encrypted organizations
   */
  async encryptOrganizations(organizations) {
    if (!Array.isArray(organizations)) return organizations;

    const encrypted = [];
    for (const org of organizations) {
      const encryptedOrg = await this.encryptOrganization(org);
      encrypted.push(encryptedOrg);
    }
    
    this.logger.debug(`Encrypted ${encrypted.length} organizations`);
    return encrypted;
  }

  /**
   * Process organizations array for decryption
   * @param {Array} organizations - Array of encrypted organizations
   * @returns {Array} Array with decrypted, non-expired organizations
   */
  async decryptOrganizations(organizations) {
    if (!Array.isArray(organizations)) return organizations;

    const decrypted = [];
    let expiredCount = 0;

    for (const org of organizations) {
      const decryptedOrg = await this.decryptOrganization(org);
      if (decryptedOrg !== null) {
        decrypted.push(decryptedOrg);
      } else {
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      this.logger.info(`Filtered out ${expiredCount} expired organizations`);
    }
    
    this.logger.debug(`Decrypted ${decrypted.length} organizations`);
    return decrypted;
  }

  /**
   * Secure deletion of sensitive data from storage
   * @param {Array} keys - Storage keys to securely delete
   */
  async secureDelete(keys = null) {
    // Use default key if none provided
    if (!keys) {
      keys = [this.config.get('STORAGE.ORGANIZATIONS_KEY', 'organizations')];
    }
    try {
      this.logger.info('Performing secure deletion of storage data', { keys });

      // Overwrite data multiple times before deletion (secure deletion pattern)
      for (let i = 0; i < 3; i++) {
        const overwriteData = {};
        for (const key of keys) {
          // Generate random data to overwrite
          const randomData = Array.from({ length: 1000 }, () => 
            Math.random().toString(36).substring(2)
          ).join('');
          overwriteData[key] = randomData;
        }
        
        await chrome.storage.local.set(overwriteData);
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
      }

      // Final deletion
      await chrome.storage.local.remove(keys);
      
      this.logger.info('Secure deletion completed successfully');
    } catch (error) {
      this.logger.error('Secure deletion failed', error);
      throw error;
    }
  }

  /**
   * Clean up expired data from storage
   * @returns {boolean} True if cleanup was performed
   */
  async cleanupExpiredData() {
    try {
      const orgKey = this.config.get('STORAGE.ORGANIZATIONS_KEY', 'organizations');
      const result = await chrome.storage.local.get([orgKey]);
      const organizations = result[orgKey] || [];
      
      if (!Array.isArray(organizations)) return false;

      const before = organizations.length;
      const validOrganizations = [];

      for (const org of organizations) {
        if (!this.isDataExpired(org)) {
          validOrganizations.push(org);
        }
      }

      const after = validOrganizations.length;
      const cleaned = before - after;

      if (cleaned > 0) {
        await chrome.storage.local.set({
          [orgKey]: validOrganizations
        });
        
        this.logger.info(`Cleaned up ${cleaned} expired organizations`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Failed to cleanup expired data', error);
      return false;
    }
  }

  /**
   * Get storage security statistics
   * @returns {Object} Security statistics
   */
  async getSecurityStats() {
    try {
      const orgKey = this.config.get('STORAGE.ORGANIZATIONS_KEY', 'organizations');
      const result = await chrome.storage.local.get([orgKey]);
      const organizations = result[orgKey] || [];
      
      let encrypted = 0;
      let expired = 0;
      let plaintext = 0;

      for (const org of organizations) {
        if (org._securityMeta?.encrypted) {
          if (this.isDataExpired(org)) {
            expired++;
          } else {
            encrypted++;
          }
        } else {
          plaintext++;
        }
      }

      return {
        total: organizations.length,
        encrypted,
        expired,
        plaintext,
        encryptionEnabled: this.encryptionKey !== null
      };
    } catch (error) {
      this.logger.error('Failed to get security stats', error);
      return {
        total: 0,
        encrypted: 0,
        expired: 0,
        plaintext: 0,
        encryptionEnabled: false,
        error: error.message
      };
    }
  }
}

// Create global instance
let storageSecurityManager;
try {
  storageSecurityManager = new StorageSecurityManager();
} catch (error) {
  console.error('Failed to initialize StorageSecurityManager:', error);
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    StorageSecurityManager,
    storageSecurityManager
  };
}

// Make available globally
if (typeof window !== 'undefined') {
  window.StorageSecurityManager = StorageSecurityManager;
  window.storageSecurityManager = storageSecurityManager;
}