/**
 * Centralized logging system for the Sitecore Portal Chrome Extension
 * 
 * @fileOverview Provides structured logging with levels and production controls
 * @author Sitecore Portal Extension
 * @version 1.0.0
 */

/**
 * Logging levels in order of severity
 */
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

/**
 * Centralized logging utility class
 */
class Logger {
  
  /**
   * Current log level - only messages at this level or higher will be logged
   * Set to ERROR in production to minimize console output
   */
  static currentLevel = LogLevel.INFO;
  
  /**
   * Production flag - when true, only ERROR level messages are logged
   */
  static isProduction = false;
  
  /**
   * Enable/disable logging entirely
   */
  static enabled = true;
  
  /**
   * Initialize logger with environment settings
   * @param {Object} config - Configuration object
   * @param {boolean} config.isProduction - Production environment flag
   * @param {boolean} config.enabled - Enable/disable logging
   * @param {string} config.level - Default log level ('DEBUG', 'INFO', 'WARN', 'ERROR')
   */
  static init(config = {}) {
    this.isProduction = config.isProduction || false;
    this.enabled = config.enabled !== false; // Default to true
    
    if (config.level) {
      this.currentLevel = LogLevel[config.level.toUpperCase()] || LogLevel.INFO;
    }
    
    // In production, only show ERROR messages by default
    if (this.isProduction) {
      this.currentLevel = LogLevel.ERROR;
    }
    
    this.info('Logger initialized', { 
      level: this.getLevelName(this.currentLevel), 
      production: this.isProduction,
      enabled: this.enabled 
    });
  }
  
  /**
   * Get level name from level number
   * @param {number} level - Log level number
   * @returns {string} Level name
   */
  static getLevelName(level) {
    const names = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    return names[level] || 'UNKNOWN';
  }
  
  /**
   * Check if a log level should be output
   * @param {number} level - Log level to check
   * @returns {boolean} Whether to log at this level
   */
  static shouldLog(level) {
    return this.enabled && level >= this.currentLevel;
  }
  
  /**
   * Format log message with timestamp and context
   * @param {string} level - Log level name
   * @param {string} message - Log message
   * @param {string} context - Context/component name
   * @param {*} data - Additional data to log
   * @returns {Array} Formatted arguments for console
   */
  static formatMessage(level, message, context = '', data = null) {
    const timestamp = new Date().toISOString().substr(11, 12); // HH:mm:ss.sss
    const prefix = `[${timestamp}] ${level}`;
    const fullMessage = context ? `${prefix} (${context}): ${message}` : `${prefix}: ${message}`;
    
    const args = [fullMessage];
    if (data !== null && data !== undefined) {
      // Ensure objects are properly formatted for console output
      if (typeof data === 'object') {
        // For Error objects, include message and stack
        if (data instanceof Error) {
          args.push({
            message: data.message,
            stack: data.stack,
            ...data
          });
        } else {
          // For regular objects, pass them directly (console will handle formatting)
          args.push(data);
        }
      } else {
        args.push(data);
      }
    }
    
    return args;
  }
  
  /**
   * Log debug message
   * @param {string} message - Debug message
   * @param {*} data - Optional data to log
   * @param {string} context - Optional context/component name
   */
  static debug(message, data = null, context = '') {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const args = this.formatMessage('DEBUG', message, context, data);
      console.debug(...args);
    }
  }
  
  /**
   * Log info message
   * @param {string} message - Info message
   * @param {*} data - Optional data to log
   * @param {string} context - Optional context/component name
   */
  static info(message, data = null, context = '') {
    if (this.shouldLog(LogLevel.INFO)) {
      const args = this.formatMessage('INFO', message, context, data);
      console.info(...args);
    }
  }
  
  /**
   * Log warning message
   * @param {string} message - Warning message
   * @param {*} data - Optional data to log
   * @param {string} context - Optional context/component name
   */
  static warn(message, data = null, context = '') {
    if (this.shouldLog(LogLevel.WARN)) {
      const args = this.formatMessage('WARN', message, context, data);
      console.warn(...args);
    }
  }
  
  /**
   * Log error message
   * @param {string} message - Error message
   * @param {*} data - Optional data to log
   * @param {string} context - Optional context/component name
   */
  static error(message, data = null, context = '') {
    if (this.shouldLog(LogLevel.ERROR)) {
      const args = this.formatMessage('ERROR', message, context, data);
      // Use console.error with proper formatting
      if (args.length > 1 && typeof args[1] === 'object') {
        // Log message and object separately for better formatting
        console.error(args[0]);
        console.error('Details:', args[1]);
      } else {
        console.error(...args);
      }
    }
  }
  
  /**
   * Create a context-bound logger for a specific component
   * @param {string} context - Component/context name
   * @returns {Object} Context-bound logger methods
   */
  static createContextLogger(context) {
    return {
      debug: (message, data = null) => this.debug(message, data, context),
      info: (message, data = null) => this.info(message, data, context),
      warn: (message, data = null) => this.warn(message, data, context),
      error: (message, data = null) => this.error(message, data, context)
    };
  }
  
  /**
   * Set logging level dynamically
   * @param {string} level - Log level name
   */
  static setLevel(level) {
    const newLevel = LogLevel[level.toUpperCase()];
    if (newLevel !== undefined) {
      this.currentLevel = newLevel;
      this.info(`Log level changed to ${level}`);
    } else {
      this.warn(`Invalid log level: ${level}`);
    }
  }
  
  /**
   * Enable or disable logging
   * @param {boolean} enabled - Enable/disable logging
   */
  static setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.info('Logging enabled');
    }
  }
}

// Auto-initialize with basic settings
// This can be overridden by calling Logger.init() with custom config
Logger.init({
  isProduction: false, // Set to true in production builds
  enabled: true,
  level: 'INFO'
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Logger, LogLevel };
} else if (typeof window !== 'undefined') {
  window.Logger = Logger;
  window.LogLevel = LogLevel;
}