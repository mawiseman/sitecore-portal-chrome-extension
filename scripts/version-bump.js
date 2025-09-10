#!/usr/bin/env node

/**
 * Version Bump Utility Script
 * 
 * Usage:
 *   node scripts/version-bump.js patch       # Bump patch version (1.0.0 -> 1.0.1)
 *   node scripts/version-bump.js minor       # Bump minor version (1.0.0 -> 1.1.0)
 *   node scripts/version-bump.js major       # Bump major version (1.0.0 -> 2.0.0)
 *   node scripts/version-bump.js 1.2.3       # Set specific version
 *   node scripts/version-bump.js current     # Show current version
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MANIFEST_PATH = path.join(__dirname, '..', 'src', 'manifest.json');

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

/**
 * Read current version from manifest.json
 */
function getCurrentVersion() {
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    return manifest.version;
  } catch (error) {
    console.error(`${colors.red}Error reading manifest.json:${colors.reset}`, error.message);
    process.exit(1);
  }
}

/**
 * Update version in manifest.json
 */
function updateVersion(newVersion) {
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const oldVersion = manifest.version;
    manifest.version = newVersion;
    
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    
    return oldVersion;
  } catch (error) {
    console.error(`${colors.red}Error updating manifest.json:${colors.reset}`, error.message);
    process.exit(1);
  }
}

/**
 * Validate version format
 */
function isValidVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/**
 * Calculate new version based on bump type
 */
function calculateNewVersion(currentVersion, bumpType) {
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  
  switch (bumpType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      if (isValidVersion(bumpType)) {
        return bumpType;
      }
      throw new Error(`Invalid bump type or version: ${bumpType}`);
  }
}

/**
 * Create git commit and tag
 */
function createGitCommitAndTag(version, createTag = true) {
  try {
    console.log(`\n${colors.blue}Creating git commit...${colors.reset}`);
    execSync('git add src/manifest.json', { stdio: 'inherit' });
    execSync(`git commit -m "chore: bump version to ${version}"`, { stdio: 'inherit' });
    
    if (createTag) {
      console.log(`\n${colors.blue}Creating git tag v${version}...${colors.reset}`);
      execSync(`git tag v${version}`, { stdio: 'inherit' });
      
      console.log(`\n${colors.green}✓ Version bumped to ${version}${colors.reset}`);
      console.log(`\nTo push changes and trigger release:`);
      console.log(`  ${colors.yellow}git push origin main${colors.reset}`);
      console.log(`  ${colors.yellow}git push origin v${version}${colors.reset}`);
    } else {
      console.log(`\n${colors.green}✓ Version bumped to ${version} (no tag created)${colors.reset}`);
      console.log(`\nTo push changes:`);
      console.log(`  ${colors.yellow}git push origin main${colors.reset}`);
    }
  } catch (error) {
    console.error(`${colors.red}Error creating git commit:${colors.reset}`, error.message);
    console.log('\nYou can manually commit with:');
    console.log(`  ${colors.yellow}git add src/manifest.json${colors.reset}`);
    console.log(`  ${colors.yellow}git commit -m "chore: bump version to ${version}"${colors.reset}`);
    console.log(`  ${colors.yellow}git tag v${version}${colors.reset}`);
  }
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`${colors.red}Error: No arguments provided${colors.reset}\n`);
    console.log('Usage:');
    console.log('  node scripts/version-bump.js patch       # Bump patch version');
    console.log('  node scripts/version-bump.js minor       # Bump minor version');
    console.log('  node scripts/version-bump.js major       # Bump major version');
    console.log('  node scripts/version-bump.js 1.2.3       # Set specific version');
    console.log('  node scripts/version-bump.js current     # Show current version');
    console.log('\nOptions:');
    console.log('  --no-tag                                  # Don\'t create git tag');
    console.log('  --no-commit                               # Don\'t create git commit');
    process.exit(1);
  }
  
  const command = args[0];
  const options = {
    createTag: !args.includes('--no-tag'),
    createCommit: !args.includes('--no-commit')
  };
  
  const currentVersion = getCurrentVersion();
  
  if (command === 'current') {
    console.log(`Current version: ${colors.green}${currentVersion}${colors.reset}`);
    return;
  }
  
  console.log(`Current version: ${colors.yellow}${currentVersion}${colors.reset}`);
  
  try {
    const newVersion = calculateNewVersion(currentVersion, command);
    
    if (newVersion === currentVersion) {
      console.log(`${colors.yellow}Version is already ${currentVersion}${colors.reset}`);
      return;
    }
    
    console.log(`New version:     ${colors.green}${newVersion}${colors.reset}`);
    
    // Update manifest.json
    updateVersion(newVersion);
    console.log(`\n${colors.green}✓ Updated manifest.json${colors.reset}`);
    
    // Create git commit and tag if requested
    if (options.createCommit) {
      createGitCommitAndTag(newVersion, options.createTag);
    } else {
      console.log(`\n${colors.green}✓ Version bumped to ${newVersion}${colors.reset}`);
      console.log('\nManual commit required:');
      console.log(`  ${colors.yellow}git add src/manifest.json${colors.reset}`);
      console.log(`  ${colors.yellow}git commit -m "chore: bump version to ${newVersion}"${colors.reset}`);
      if (options.createTag) {
        console.log(`  ${colors.yellow}git tag v${newVersion}${colors.reset}`);
      }
    }
    
  } catch (error) {
    console.error(`\n${colors.red}Error:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}