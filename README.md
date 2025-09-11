# Sitecore Portal Quicklinks Chrome Extension

A productivity Chrome extension that automatically detects and saves Sitecore Portal organizations and tenants, providing quick access through a convenient browser popup.

## 🚀 Features

- **Automatic Organization Detection**: Automatically captures organization information when visiting Sitecore Portal
- **Tenant/Subsite Management**: Organizes tenants by product groups for easy navigation
- **Quick Access Popup**: One-click navigation to saved organizations and tenants
- **Custom Naming**: Edit organization and tenant names for personalized organization
- **Current Context Awareness**: Visual indication of the currently active organization
- **Security-First Design**: URL validation, input sanitization, and safe navigation
- **Memory Management**: Optimized resource usage with cleanup mechanisms

## 📋 Prerequisites

- Google Chrome 88+ (Manifest V3 support)
- Access to Sitecore Portal (https://portal.sitecorecloud.io/)

## 🛠 Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the `src` folder
5. The extension will appear in your Chrome toolbar

### Chrome Web Store (Future)

Extension will be available on the Chrome Web Store for easy installation.

## 📁 Project Structure

```
src/
├── config/
│   └── config.js              # Configuration settings and constants
├── core/
│   ├── background.js          # Background service worker
│   ├── content.js             # Content script for organization detection
│   ├── inject.js              # Page injection utilities
│   ├── popup.js               # Popup interface controller
│   └── secureInject.js        # Secure data capture script
├── managers/
│   ├── contextValidator.js    # Context validation utilities
│   ├── errorHandler.js        # Error handling and recovery
│   ├── memoryManager.js       # Memory and resource management
│   ├── optimizedRequestInterceptor.js # HTTP request interception
│   ├── requestLifecycleManager.js     # Request lifecycle handling
│   └── storageConsistencyManager.js  # Storage consistency checks
├── ui/
│   ├── icons/                 # Extension icons (16px, 48px, 128px)
│   ├── popup.html            # Popup interface HTML
│   └── popup.css             # Popup interface styles
├── utils/
│   ├── asyncUtils.js         # Asynchronous utility functions
│   ├── logger.js             # Logging utilities
│   ├── security.js           # Security validation functions
│   ├── sharedUtils.js        # Shared utility functions
│   └── storageSecurityManager.js # Storage security management
└── manifest.json             # Extension manifest (Manifest V3)
```

## 🔧 Technical Architecture

### Core Components

- **Content Script** (`content.js`): Monitors Sitecore Portal pages and captures organization/tenant data
- **Background Service Worker** (`background.js`): Handles HTTP request interception and message passing
- **Popup Interface** (`popup.js`): Manages the extension popup with organization/tenant listings
- **Security Layer** (`security.js`): Validates URLs, sanitizes inputs, and prevents XSS attacks

### Data Flow

1. User visits `portal.sitecorecloud.io` with organization parameter
2. Content script detects organization ID from URL
3. Background worker intercepts API responses for organizations/tenants
4. Data is validated, sanitized, and stored locally
5. Popup displays organized data with navigation options

### Security Features

- URL validation and sanitization
- Input validation for user-provided data
- CSP (Content Security Policy) enforcement
- Safe navigation with malicious URL detection
- Memory management to prevent leaks

## 🎯 Usage

1. **Automatic Detection**: Visit any Sitecore Portal organization URL - the extension automatically saves it
2. **Quick Access**: Click the extension icon to see your saved organizations
3. **Navigate**: Click any organization or tenant to open it in a new tab
4. **Organize**: Expand organizations to see grouped tenants by product type
5. **Customize**: Edit organization/tenant names using the edit icons
6. **Manage**: Delete organizations you no longer need

### Supported URLs

- Organization URLs: `https://portal.sitecorecloud.io/?organization=[org-id]`
- Tenant URLs: Various Sitecore product URLs (XM Cloud, Content Hub, etc.)

## ⚙️ Configuration

Key configuration options in `config.js`:

- `ALLOWED_DOMAINS`: Permitted domains for operation
- `TIMEOUTS`: Various timeout settings for API calls
- `LIMITS`: Rate limiting and data size constraints
- `SECURITY`: Security validation settings

## 🔒 Security & Privacy

- **Local Storage Only**: All data stored locally in browser, no external transmission
- **Minimal Permissions**: Only requests necessary Chrome API permissions
- **Domain Restrictions**: Limited to Sitecore Portal domains only
- **Input Validation**: All user inputs validated and sanitized
- **Safe Navigation**: URLs validated before navigation

## 🐛 Known Issues & Limitations

- No cross-browser sync (Chrome storage only)
- Limited to Sitecore Portal domain
- Dynamic content may require retry attempts
- No backup/restore functionality

## 🚧 Development

### Prerequisites for Development

- Basic understanding of Chrome Extension APIs
- Knowledge of Manifest V3 format
- JavaScript ES6+ familiarity

### Development Setup

1. Clone the repository
2. Make changes to files in the `src/` directory
3. Reload extension in Chrome (`chrome://extensions/`)
4. Test changes in browser

### Key Development Notes

- Extension uses Manifest V3 (latest standard)
- No external dependencies or build process required
- All code is vanilla JavaScript
- Follows Chrome Extension security best practices

## 📝 Changelog

### Version 1.0 (Current)
- Initial release with organization detection
- Tenant/subsite grouping by product type
- Custom naming functionality
- Security enhancements
- Memory management improvements

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👤 Author

**Mark Wiseman**
- Email: mark@wiseman.net.au
- Website: https://wiseman.net.au

## 🆘 Support

For issues, questions, or feature requests:
1. Check existing documentation
2. Review known issues above
3. Create an issue in the project repository

## 🏗 Future Enhancements

Potential improvements for future versions:
- Search/filter functionality for large lists
- Organization categorization and tagging
- Export/import organization data
- Keyboard shortcuts for navigation
- Dark mode support
- Chrome sync integration
- Multi-language support (i18n)

---

*This extension is designed to improve productivity for Sitecore professionals by providing quick access to frequently used portal resources.*