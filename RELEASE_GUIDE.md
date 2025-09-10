# Release Guide

This guide explains how to manage versions and create releases for the Sitecore Portal Chrome Extension.

## 🔄 Version Management

The extension uses semantic versioning (MAJOR.MINOR.PATCH) with automated version management.

### Quick Start - Creating a Release

**Option 1: Use GitHub Actions (Recommended)**
1. Go to GitHub → Actions → "Version Bump and Release"
2. Choose version type (patch/minor/major)
3. Click "Run workflow"
4. Everything is automated!

**Option 2: Use Local Scripts**
```bash
# Bump version and create release
node scripts/version-bump.js patch
git push origin main
git push origin --tags
```

### Version Bump Scripts

#### Node.js Version
```bash
# Show current version
node scripts/version-bump.js current

# Bump versions
node scripts/version-bump.js patch       # 1.0.0 -> 1.0.1
node scripts/version-bump.js minor       # 1.0.0 -> 1.1.0
node scripts/version-bump.js major       # 1.0.0 -> 2.0.0
node scripts/version-bump.js 1.2.3       # Set specific version

# Options
node scripts/version-bump.js patch --no-tag     # Don't create git tag
node scripts/version-bump.js patch --no-commit  # Don't commit changes
```

#### PowerShell Version (Windows)
```powershell
# Show current version
.\scripts\version-bump.ps1 current

# Bump versions
.\scripts\version-bump.ps1 patch
.\scripts\version-bump.ps1 minor
.\scripts\version-bump.ps1 major
.\scripts\version-bump.ps1 1.2.3

# Options
.\scripts\version-bump.ps1 patch -NoTag
.\scripts\version-bump.ps1 patch -NoCommit
```

## 🚀 GitHub Actions Workflows

### 1. Version Bump and Release (`version-bump.yml`)

**Purpose**: Automated version management with optional release creation

**Features**:
- Auto-increments version in manifest.json
- Commits changes to repository
- Creates git tags
- Optionally creates GitHub releases with zip files

**Trigger**: Manual dispatch from GitHub Actions

**Usage**:
1. Go to Actions → "Version Bump and Release"
2. Select version type:
   - `patch`: Bug fixes (1.0.0 → 1.0.1)
   - `minor`: New features (1.0.0 → 1.1.0)
   - `major`: Breaking changes (1.0.0 → 2.0.0)
   - `custom`: Specify exact version
3. Choose whether to create release
4. Run workflow

### 2. Release Chrome Extension (`release.yml`)

**Purpose**: Create releases from existing version tags

**Features**:
- Triggers on version tags (v*.*.*)
- Updates manifest.json to match tag
- Creates extension zip file
- Creates source code archive
- Publishes GitHub release with assets

**Triggers**:
- Push of version tag (`v1.0.1`)
- Manual dispatch with version input

**Usage**:
```bash
# Tag-based release
git tag v1.0.1
git push origin v1.0.1

# Or manual trigger from GitHub Actions
```

### 3. Chrome Web Store Publishing (`chrome-web-store.yml`)

**Purpose**: Publish extension to Chrome Web Store

**Features**:
- Updates manifest version
- Creates extension package
- Publishes to Chrome Web Store
- Supports different publish targets

**Trigger**: Manual dispatch only

**Setup Required**: See Chrome Web Store Setup section below

## 📦 Release Process Workflows

### Standard Release Flow

1. **Development Phase**
   - Make code changes
   - Test locally
   - Commit changes

2. **Version Bump**
   ```bash
   node scripts/version-bump.js patch
   ```

3. **Push Changes**
   ```bash
   git push origin main
   git push origin --tags
   ```

4. **Automatic Release**
   - GitHub Action triggers on tag push
   - Creates release with zip files
   - Ready for distribution!

### Quick Patch Release

```bash
# One-command release
node scripts/version-bump.js patch && git push origin main --follow-tags
```

### Major Release with Changelog

1. Update version:
   ```bash
   node scripts/version-bump.js major
   ```

2. Update documentation if needed

3. Push and release:
   ```bash
   git push origin main
   git push origin --tags
   ```

## 🏪 Chrome Web Store Setup

### Prerequisites

1. **Chrome Web Store Developer Account**
   - Register at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard)
   - Pay one-time registration fee

2. **OAuth 2.0 Credentials**
   - Create Google Cloud Project
   - Enable Chrome Web Store API
   - Create OAuth credentials

### Getting API Credentials

1. **Create OAuth Client**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create new project or select existing
   - Enable Chrome Web Store API
   - Create OAuth 2.0 Client ID (Desktop type)

2. **Get Refresh Token**:
   ```javascript
   // Save as get-token.js and run with Node.js
   const CLIENT_ID = 'your-client-id';
   const CLIENT_SECRET = 'your-client-secret';
   
   console.log('Visit this URL:');
   console.log(`https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=${CLIENT_ID}&redirect_uri=urn:ietf:wg:oauth:2.0:oob`);
   
   // Follow instructions to get refresh token
   ```

3. **Set GitHub Secrets**:
   - `CHROME_EXTENSION_ID`: Your extension ID
   - `CHROME_CLIENT_ID`: OAuth client ID
   - `CHROME_CLIENT_SECRET`: OAuth client secret
   - `CHROME_REFRESH_TOKEN`: Refresh token

### Publishing to Chrome Web Store

1. Go to GitHub → Actions → "Publish to Chrome Web Store"
2. Enter version number
3. Select publish target:
   - `default`: Public release
   - `trustedTesters`: Limited release
4. Run workflow

## 🎯 Version Guidelines

### Semantic Versioning

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes
  - Removing features
  - Major UI redesign
  - Incompatible API changes

- **MINOR** (1.0.0 → 1.1.0): New features
  - Adding functionality
  - Minor UI improvements
  - Backward compatible changes

- **PATCH** (1.0.0 → 1.0.1): Bug fixes
  - Fixing bugs
  - Security patches
  - Performance improvements

### Version Commit Messages

The scripts automatically create standardized commit messages:
```
chore: bump version to 1.0.1
```

### Version Tags

Tags are created in the format `v1.0.1` and trigger automatic releases.

## 📋 Release Checklist

Before creating a release:

- [ ] All code changes committed and pushed
- [ ] Extension tested locally
- [ ] `manifest.json` permissions reviewed
- [ ] Documentation updated if needed
- [ ] Version number decided (semantic versioning)
- [ ] Previous version tag exists (for changelog generation)

## 🔍 Troubleshooting

### Common Issues

**Version Mismatch**
```bash
# Check current version
node scripts/version-bump.js current

# Check git tags
git tag -l

# Align manifest with tag
node scripts/version-bump.js 1.0.1
```

**Failed GitHub Action**
- Check Actions tab for error logs
- Verify GitHub secrets are set correctly
- Ensure proper permissions in workflow

**Git Push Errors**
```bash
# Push with tags
git push origin main --follow-tags

# Or separately
git push origin main
git push origin v1.0.1
```

### Manual Release Process

If automation fails:

1. Update manifest.json manually
2. Create git tag:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```
3. Create release on GitHub manually
4. Upload zip files as release assets

## 📊 Release Assets

Each release includes:

### Extension Package
`sitecore-portal-chrome-extension-1.0.1.zip`
- Ready for Chrome installation
- Contains all extension files
- Updated manifest.json

### Source Archive
`sitecore-portal-chrome-extension-source-1.0.1.zip`
- Complete source code
- Documentation
- Build scripts
- Excludes: .git, node_modules, build artifacts

## 🤝 Contributing

When contributing:

1. Create feature branch
2. Make changes
3. Test thoroughly
4. Create pull request
5. Maintainers handle version bumps and releases

Do not bump versions in pull requests unless requested.

## 📝 Examples

### Example: Quick Bug Fix Release
```bash
# Fix bug in code
git add .
git commit -m "fix: resolve organization detection issue"

# Bump patch version and release
node scripts/version-bump.js patch
git push origin main --follow-tags
```

### Example: Feature Release
```bash
# After feature development
git add .
git commit -m "feat: add dark mode support"

# Bump minor version
node scripts/version-bump.js minor
git push origin main
git push origin --tags
```

### Example: Using GitHub Actions
1. Push your code changes
2. Go to GitHub Actions
3. Run "Version Bump and Release"
4. Select "minor" for new feature
5. Enable "Create Release"
6. Click "Run workflow"
7. Done! Check Releases page

---

This automated system ensures consistent, reliable releases with proper versioning and comprehensive release notes.