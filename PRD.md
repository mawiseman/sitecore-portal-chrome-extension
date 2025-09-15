# Product Requirements Document (PRD)
## Sitecore Portal Quicklinks Chrome Extension

### 1. Executive Summary

The Sitecore Portal Quicklinks Chrome Extension is an enterprise-grade productivity tool designed to help Sitecore administrators and developers quickly access and manage their various Sitecore Portal organizations. The extension features automatic organization detection with secure API response interception, comprehensive tenant management grouped by product types, and a modern user interface with advanced security features. It provides instant access to frequently used organizations through a convenient browser extension popup with custom naming capabilities and intelligent user guidance.

### 2. Product Overview

#### 2.1 Purpose
To streamline the workflow of Sitecore professionals who manage multiple organizations by providing instant access to saved organization links without manual bookmarking or searching.

#### 2.2 Target Audience
- Sitecore administrators
- Sitecore developers
- Digital marketing teams using Sitecore
- IT professionals managing multiple Sitecore instances

#### 2.3 Key Value Propositions
- **Time Savings**: Eliminates the need to manually navigate or search for organization portals
- **Automatic Detection**: Intelligently captures organization information without user intervention
- **Enterprise Security**: Comprehensive security layer with URL validation, XSS prevention, and encrypted storage
- **Quick Access**: One-click navigation to any saved organization with security validation
- **Advanced Management**: Custom naming, tenant grouping by product, and easy organization management
- **Current Context Awareness**: Visual indication of the currently active organization
- **User Guidance**: Contextual help messages for better user experience
- **Performance Optimized**: Memory management, request deduplication, and resource cleanup

### 3. Technical Architecture

#### 3.1 Extension Components

##### 3.1.1 Manifest Configuration (manifest.json)
- **Version**: Manifest V3 (latest Chrome extension standard)
- **Permissions**: 
  - `storage`: For persisting organization data
  - `activeTab`: For detecting current tab information
  - `webRequest`: For intercepting API responses
  - `alarms`: For scheduled operations
  - `management`: For extension management
- **Host Permissions**: 
  - `https://portal.sitecorecloud.io/*`
  - `https://identity.sitecorecloud.io/*`
- **Content Scripts**: Comprehensive injection system with multiple utilities
- **Background Service Worker**: Handles request interception and lifecycle management

##### 3.1.2 Content Script System
- **Primary Class**: `SitecoreOrganizationDetector`
- **Dependencies**: Config, Logger, AsyncUtils, Security, Error Handler, Memory Manager
- **Secure Injection**: SecureInject.js replaces unsafe eval-based methods
- **Key Responsibilities**:
  - Intercept HTTP requests via background worker communication
  - Detect organization ID from URL parameters
  - Process API responses for organizations and tenants
  - Implement secure data capture with validation and sanitization
  - Handle tenant grouping by product types
  - Memory management with automatic cleanup mechanisms
  - Tamper-proof request interception with integrity checks

##### 3.1.3 Popup Interface (popup.html/popup.js)
- **Primary Class**: `OrganizationManager`
- **Dependencies**: Security utilities, shared storage manager, error handling
- **Enhanced Features**:
  - Display saved organizations with tenant grouping
  - Expandable/collapsible product groups
  - Custom naming for organizations and tenants
  - Edit functionality with validation
  - Current organization context awareness
  - Secure navigation with URL validation
  - Memory management and cleanup

##### 3.1.4 Background Service Worker (background.js)
- **Key Features**:
  - HTTP request interception for organizations/tenants APIs
  - Message passing between content scripts and popup
  - Request lifecycle management
  - Optimized request handling with debouncing

##### 3.1.5 Enterprise Security Layer
- **Components**: SecurityUtils, StorageSecurityManager
- **Features**:
  - URL validation with whitelist and malicious pattern detection
  - Input validation and sanitization for all user data
  - XSS prevention with strict Content Security Policy
  - Safe navigation checks before opening URLs
  - HTML entity decoding for safe display
  - AES-GCM encryption for sensitive storage fields
  - 24-hour TTL for cached data with automatic cleanup
  - Strict CSP: No unsafe-inline styles allowed

##### 3.1.6 Enhanced Manager Classes (16 Total)
- **ErrorHandler**: Enterprise error handling with classification and recovery
- **MemoryManager**: Comprehensive resource cleanup with WeakMap tracking
- **ContextValidator**: Context validation utilities
- **StorageConsistencyManager**: Atomic operations with rollback capability
- **OptimizedRequestInterceptor**: Request deduplication and optimization
- **RequestLifecycleManager**: Prevents race conditions in requests
- **Logger**: Centralized logging system (replaced 99+ console statements)
- **AsyncUtils**: Standardized async patterns and utilities
- **DomUtils**: Safe DOM manipulation utilities
- **StorageManager**: Unified storage operations with validation

#### 3.2 Enhanced Data Structures

```javascript
Organization {
  id: string,           // Organization ID from URL parameter
  name: string,         // Original organization name
  customName?: string,  // User-defined custom name
  url: string,          // Full URL to the organization portal
  productGroups: ProductGroup[], // Grouped tenants by product
  lastUpdated?: string, // Last update timestamp
  lastSubsiteUpdate?: string // Last tenant update timestamp
}

ProductGroup {
  productName: string,  // Product name (e.g., "XM Cloud")
  iconSrc: string,      // Product icon URL
  tenants: Tenant[]     // List of tenants in this product
}

Tenant {
  id: string,           // Tenant ID
  name: string,         // Tenant name
  displayName: string,  // Tenant display name
  customName?: string,  // User-defined custom name
  url: string,          // Tenant URL
  organizationId: string, // Parent organization ID
  actions: Action[]     // Available tenant actions
}

Action {
  name: string,         // Action name
  displayName: string,  // Action display name
  url: string,          // Action URL
  category: string,     // Action category
  description?: string, // Action description
  icon?: Icon          // Action icon
}
```

### 4. Core Features

#### 4.1 Advanced Data Capture System
**Description**: Automatically detects and saves Sitecore organizations and tenants through secure API response interception.

**Technical Implementation**:
- Background service worker intercepts API responses
- Secure injection scripts capture response data
- Organization ID extracted from URL parameters
- Tenant data processed and grouped by product type
- Comprehensive error handling with retry mechanisms
- Memory-efficient processing with cleanup

**User Experience**:
- Zero-click saving - completely automatic
- Real-time tenant data capture
- Organized by product groups (XM Cloud, Content Hub, etc.)
- Updates existing data when revisited

#### 4.2 Enhanced Organization Management
**Description**: Provides comprehensive organization and tenant management through an advanced popup interface.

**Features**:
- Hierarchical display with expandable product groups
- Tenant organization by product type (XM Cloud, Content Hub, etc.)
- Custom naming for organizations and tenants
- Edit functionality with input validation
- Current organization context indicator
- Alphabetically sorted listings
- One-click navigation with security validation
- Tenant action shortcuts (Quick Actions, Helpful Links)

#### 4.3 Security & Validation Features
**Description**: Comprehensive security layer protecting user data and preventing malicious activity.

**Features**:
- URL validation before navigation
- Input sanitization for user-provided names
- XSS prevention mechanisms
- Safe HTML entity decoding
- Malicious URL pattern detection
- Content Security Policy enforcement
- Secure storage operations

#### 4.4 Memory & Performance Management
**Description**: Optimized resource usage and performance monitoring.

**Features**:
- Automatic memory cleanup on popup close
- Observer pattern cleanup
- Event listener management
- Resource timeout handling
- Efficient storage operations
- Background worker optimization

### 5. User Interface Design

#### 5.1 Modern Popup Interface
- **Dimensions**: 400px width, dynamic height based on content
- **Layout**: Hierarchical with expandable sections
- **Design System**: 
  - Background: Linear gradient (135deg, #6b46ff to #ff6b6b)
  - Organization cards: White with rounded corners (6px radius)
  - Product groups: Nested expandable sections with hover states
  - Current badge: Purple (#6b46ff) with white text
  - Custom names: Italic styling with asterisk indicator
  - Action buttons: Contextual colors (edit, delete, save, cancel)
  - Edit mode: Highlighted input with shadow and z-index layering

#### 5.2 Enhanced Visual Elements
- **Icons**: 
  - Organization icon (building outline SVG)
  - Expand/collapse icons with rotation animation
  - Product icons from API responses
  - Edit icons for inline name customization
  - Delete icon (trash can SVG)
  - Action icons (first letter fallback)
  - Extension icon set (16px, 48px, 128px)
  - Sitecore branding in user guidance
- **User Guidance System**:
  - Contextual help messages
  - Portal navigation prompts
  - Empty state guidance
  - Visual feedback for all actions
- **Typography**: 
  - System fonts (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto)
  - Custom name styling (italic)
  - Truncated text with tooltips
- **Interactions**: 
  - Smooth expand/collapse animations
  - Hover states for all interactive elements
  - Edit mode with inline controls
  - Visual feedback for all actions

### 6. Enhanced Data Flow

```
1. User visits portal.sitecorecloud.io with organization parameter
   ↓
2. Background service worker intercepts API requests
   ↓
3. Content script detects organization ID from URL
   ↓
4. Secure injection script captures API response data
   ↓
5. Organization and tenant data processed and validated
   ↓
6. Data grouped by product types and stored securely
   ↓
7. User clicks extension icon
   ↓
8. Popup loads hierarchical data with memory management
   ↓
9. Organizations displayed with expandable tenant groups
   ↓
10. User can edit names, navigate, or manage organizations
   ↓
11. All actions validated and executed securely
```

### 7. Security & Privacy

#### 7.1 Permissions
- **Minimal Scope**: Only requests necessary permissions
- **Host Restrictions**: Limited to Sitecore Portal domain
- **Local Storage**: All data stored locally, no external transmission

#### 7.2 Data Handling
- No personal data collection beyond organization information
- No analytics or tracking
- No external API calls
- All data remains in user's browser

### 8. Performance Considerations

#### 8.1 Completed Optimization Strategies
- Centralized logging system (99+ console.log statements replaced)
- Memory leak prevention with WeakMap-based tracking
- Request interception optimization with deduplication
- Code deduplication (~200 lines eliminated)
- Async pattern standardization with AsyncUtils
- Efficient DOM querying with specific selectors
- Debounced mutation observation
- Quick popup load times (<100ms)
- Sorted data for better UX

#### 8.2 Resource Management
- Automatic memory cleanup on popup close
- Observer pattern cleanup and resource management
- Background worker optimization with single-strategy approach
- Event listener management with automatic cleanup
- Efficient storage operations with atomic transactions
- Small asset sizes with optimized icons

### 9. Browser Compatibility

- **Primary Target**: Google Chrome (latest versions)
- **Manifest Version**: V3 (modern standard)
- **Minimum Chrome Version**: 88+ (Manifest V3 support)

### 10. Installation & Distribution

#### 10.1 Installation Methods
- Chrome Web Store (recommended)
- Developer mode installation for testing
- Enterprise deployment via policy

#### 10.2 Updates
- Automatic updates through Chrome Web Store
- Version tracking in manifest.json
- No breaking changes to storage format

### 11. Future Enhancements

#### 11.1 Planned Features
- Search/filter functionality for large organization lists
- Debug mode to inspect stored extension data
- Sync renamed items with portal dashboard
- Organization grouping or categorization
- Export/import organization lists
- Keyboard shortcuts for quick access
- Organization favicon detection
- Last visited timestamp
- Custom organization notes
- Multi-browser sync via Chrome account
- Testing framework implementation
- Performance monitoring system

#### 11.2 Technical Improvements
- Background service worker for enhanced performance
- Context menu integration
- Omnibox suggestions
- Badge notifications for organization changes
- Dark mode support
- Internationalization (i18n)

### 12. Known Issues & Limitations

#### 12.1 Current Limitations
- No cross-browser synchronization (Chrome storage only)
- Limited to Sitecore Portal domains
- No backup/restore functionality
- No search/filter capability for large organization lists
- Tenant actions limited to Quick Actions category
- Custom names stored locally without cloud sync
- Renamed items revert to original names on portal page refresh
- No debug mode to inspect stored data

#### 12.2 Edge Cases
- Dynamic content may require retry attempts
- Organization name changes not automatically updated
- Limited to portal.sitecorecloud.io domain
- Occasional portal loading blocks may occur
- Custom names not reflected in portal dashboard

### 13. Development Information

#### 13.1 Enhanced Project Structure
```
src/
├── config/
│   └── config.js              # Configuration and constants
├── core/
│   ├── background.js          # Background service worker
│   ├── content.js             # Content script for detection
│   ├── inject.js              # Injection utilities
│   ├── popup.js               # Popup interface controller
│   └── secureInject.js        # Secure data capture
├── managers/
│   ├── contextValidator.js    # Context validation
│   ├── errorHandler.js        # Error handling and recovery
│   ├── memoryManager.js       # Memory management
│   ├── optimizedRequestInterceptor.js # Request interception
│   ├── requestLifecycleManager.js     # Lifecycle management
│   └── storageConsistencyManager.js  # Storage integrity
├── ui/
│   ├── icons/                 # Extension icons (16, 48, 128px)
│   ├── popup.html            # Popup interface HTML
│   └── popup.css             # Popup interface styles
├── utils/
│   ├── asyncUtils.js         # Async utilities
│   ├── logger.js             # Logging system
│   ├── security.js           # Security validation
│   ├── sharedUtils.js        # Shared utilities
│   └── storageSecurityManager.js # Storage security
└── manifest.json             # Extension manifest (V3)
```

#### 13.2 Enhanced Technology Stack
- **Core**: Vanilla JavaScript (ES6+) with no external dependencies
- **APIs**: Chrome Extension APIs (Manifest V3)
  - Storage API with encryption for local data persistence
  - Tabs API for secure navigation
  - Runtime API for messaging
  - WebRequest API for tamper-proof response interception
  - Alarms API for scheduled cleanup operations
- **Architecture**: Modular design with 16 specialized manager classes
- **Security**: Enterprise-grade with AES-GCM encryption, CSP hardening, XSS prevention
- **UI**: Semantic HTML5 with responsive CSS3 and modern gradient design
- **Performance**: Comprehensive memory management, request optimization, resource cleanup
- **Logging**: Centralized system replacing 99+ console statements
- **Storage**: Atomic operations with rollback capability

### 14. Success Metrics

- Number of organizations successfully detected and saved
- Average time saved per navigation
- User retention rate
- Error-free operation rate
- Popup load time < 100ms

### 15. Support & Maintenance

#### 15.1 Author
Mark Wiseman (mark@wiseman.net.au)

#### 15.2 Homepage
https://wiseman.net.au

#### 15.3 Version Management
**Current Version**: 1.0 (Production Ready)
- Semantic versioning for updates (MAJOR.MINOR.PATCH)
- Enterprise-grade security layer with encryption and CSP
- Advanced tenant management with product grouping
- 16 specialized manager classes for modular architecture
- All major optimizations completed (memory, logging, requests)
- Modern UI with gradient design and user guidance
- Comprehensive error handling with classification and recovery

---

*This PRD represents the current state of the Sitecore Portal Quicklinks Chrome Extension and serves as a comprehensive guide for understanding its functionality, architecture, and potential future development.*