# Release Guide

This guide explains how to create releases for the Sitecore Portal Chrome Extension.

## 🚀 Quick Start

### Creating a Release (Simple!)

1. Go to GitHub → Actions → "Release"
2. Choose version type:
   - `patch` - Bug fixes (1.0.0 → 1.0.1)
   - `minor` - New features (1.0.0 → 1.1.0)  
   - `major` - Breaking changes (1.0.0 → 2.0.0)
3. Add optional release notes
4. Click "Run workflow"
5. Done! The workflow will:
   - Bump the version
   - Update manifest.json
   - Create zip files
   - Create GitHub release
   - Upload assets

## 🏗️ GitHub Actions Workflows

The project uses just **2 simple workflows**:

### 1. Build and Test (`build-and-test.yml`)

**When it runs**: Every commit to main/develop, and on pull requests

**What it does**:
- ✅ Validates manifest.json
- ✅ Checks file structure
- ✅ Validates JavaScript syntax
- ✅ Builds test package
- ✅ Runs security checks
- ✅ Generates build report

### 2. Release (`release.yml`)

**When it runs**: Manual trigger only (you control when)

**What it does**:
- 📝 Bumps version automatically
- 📦 Creates extension zip
- 📄 Creates source archive
- 🏷️ Creates git tag
- 🚀 Publishes GitHub release
- 📎 Uploads zip files as assets

## 📦 Version Management

### Semantic Versioning

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes
- **MINOR** (1.0.0 → 1.1.0): New features
- **PATCH** (1.0.0 → 1.0.1): Bug fixes

### Local Scripts (Optional)

If you prefer working locally:

```bash
# Show current version
node scripts/version-bump.js current

# Bump version
node scripts/version-bump.js patch
node scripts/version-bump.js minor
node scripts/version-bump.js major

# Push changes
git push origin main --follow-tags
```

**PowerShell (Windows)**:
```powershell
.\scripts\version-bump.ps1 patch
.\scripts\version-bump.ps1 minor
.\scripts\version-bump.ps1 major
```

## 🎯 Release Process

### Standard Flow

1. **Develop** - Make your changes
2. **Commit** - Push to main branch
3. **Test** - Build and Test workflow runs automatically
4. **Release** - Go to Actions → Release → Run workflow

### Example Workflows

#### Quick Bug Fix
```bash
# Fix the bug
git add .
git commit -m "fix: resolve detection issue"
git push

# Then go to GitHub Actions → Release → Run (patch)
```

#### New Feature
```bash
# Develop feature
git add .
git commit -m "feat: add dark mode"
git push

# Then go to GitHub Actions → Release → Run (minor)
```

## 📋 Release Checklist

Before creating a release:

- [ ] Code committed and pushed
- [ ] Build and Test workflow passing
- [ ] Decide version type (patch/minor/major)
- [ ] Prepare release notes (optional)

## 🏪 Chrome Web Store

After creating a GitHub release:

1. Download the extension zip from Releases page
2. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard)
3. Upload new version
4. Submit for review

## 📊 Release Assets

Each release includes:

### Extension Package
`sitecore-portal-chrome-extension-{version}.zip`
- Ready to install in Chrome
- Ready for Chrome Web Store

### Source Archive
`sitecore-portal-chrome-extension-source-{version}.zip`
- Complete source code
- For transparency and archival

## 🔍 Troubleshooting

### Check Current Version
```bash
# In manifest.json
cat src/manifest.json | grep version

# Using script
node scripts/version-bump.js current
```

### Manual Release (If Actions Fail)
```bash
# Update version
node scripts/version-bump.js patch

# Push with tags
git push origin main --follow-tags

# Create release manually on GitHub
```

### Failed Workflow
1. Check Actions tab for error details
2. Verify file structure is intact
3. Ensure manifest.json is valid JSON

## 💡 Tips

- **Keep it simple**: Use GitHub Actions for releases
- **Test first**: Let Build and Test run before releasing
- **Version wisely**: Follow semantic versioning
- **Document changes**: Add meaningful release notes

## 🤝 Contributing

Contributors should:
1. Create feature branches
2. Make changes
3. Submit pull requests
4. Let maintainers handle releases

Don't bump versions in PRs unless requested.

---

**Need help?** Check the [Actions tab](../../actions) or open an issue!