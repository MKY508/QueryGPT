#!/bin/bash

# QueryGPT Release Script
# Automates the release process including version updates, changelog generation, and Git tagging

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_color() {
    color=$1
    message=$2
    echo -e "${color}${message}${NC}"
}

# Function to validate version format
validate_version() {
    if ! [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        print_color $RED "Error: Version must be in format X.Y.Z (e.g., 1.0.0)"
        exit 1
    fi
}

# Function to update version in a file
update_version_in_file() {
    file=$1
    old_version=$2
    new_version=$3
    
    if [ -f "$file" ]; then
        sed -i.bak "s/$old_version/$new_version/g" "$file"
        rm -f "$file.bak"
        print_color $GREEN "✓ Updated version in $file"
    else
        print_color $YELLOW "⚠ File $file not found, skipping..."
    fi
}

# Main script
print_color $GREEN "==================================="
print_color $GREEN "QueryGPT Release Script"
print_color $GREEN "==================================="

# Check if we're in the right directory
if [ ! -f "VERSION" ]; then
    print_color $RED "Error: VERSION file not found. Are you in the project root?"
    exit 1
fi

# Get current version
CURRENT_VERSION=$(cat VERSION)
print_color $YELLOW "Current version: $CURRENT_VERSION"

# Ask for new version
read -p "Enter new version (format: X.Y.Z): " NEW_VERSION

# Validate version format
validate_version $NEW_VERSION

# Compare versions
if [ "$NEW_VERSION" == "$CURRENT_VERSION" ]; then
    print_color $RED "Error: New version must be different from current version"
    exit 1
fi

# Ask for release type
print_color $YELLOW "\nSelect release type:"
echo "1) Major release (breaking changes)"
echo "2) Minor release (new features)"
echo "3) Patch release (bug fixes)"
read -p "Enter choice (1-3): " RELEASE_TYPE

# Get release notes
print_color $YELLOW "\nEnter release notes (press Ctrl+D when done):"
RELEASE_NOTES=$(cat)

# Update VERSION file
echo "$NEW_VERSION" > VERSION
print_color $GREEN "✓ Updated VERSION file"

# Update version in Python files
update_version_in_file "backend/__init__.py" "__version__ = \"$CURRENT_VERSION\"" "__version__ = \"$NEW_VERSION\""

# Update version in package.json
update_version_in_file "package.json" "\"version\": \"$CURRENT_VERSION\"" "\"version\": \"$NEW_VERSION\""

# Update version in requirements.txt comments (if exists)
update_version_in_file "requirements.txt" "# QueryGPT v$CURRENT_VERSION" "# QueryGPT v$NEW_VERSION"

# Get current date
RELEASE_DATE=$(date +%Y-%m-%d)

# Update CHANGELOG.md
print_color $YELLOW "\nUpdating CHANGELOG.md..."

# Create temporary file with new changelog entry
cat > /tmp/changelog_new.md << EOF
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [$NEW_VERSION] - $RELEASE_DATE

$RELEASE_NOTES

EOF

# Append the rest of the changelog (excluding the header and unreleased section)
tail -n +$(grep -n "## \[" CHANGELOG.md | head -2 | tail -1 | cut -d: -f1) CHANGELOG.md >> /tmp/changelog_new.md

# Replace the old changelog
mv /tmp/changelog_new.md CHANGELOG.md
print_color $GREEN "✓ Updated CHANGELOG.md"

# Git operations
print_color $YELLOW "\nPreparing Git release..."

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    print_color $YELLOW "Uncommitted changes detected. Committing release changes..."
    
    git add VERSION CHANGELOG.md backend/__init__.py package.json requirements.txt 2>/dev/null || true
    git commit -m "Release version $NEW_VERSION

Release notes:
$RELEASE_NOTES"
    
    print_color $GREEN "✓ Committed release changes"
fi

# Create Git tag
TAG_NAME="v$NEW_VERSION"
print_color $YELLOW "Creating Git tag: $TAG_NAME"

git tag -a "$TAG_NAME" -m "Release version $NEW_VERSION

$RELEASE_NOTES"

print_color $GREEN "✓ Created Git tag: $TAG_NAME"

# Ask if user wants to push
read -p "Do you want to push changes and tag to remote? (y/n): " PUSH_CONFIRM

if [ "$PUSH_CONFIRM" == "y" ] || [ "$PUSH_CONFIRM" == "Y" ]; then
    print_color $YELLOW "Pushing to remote..."
    
    # Push commits
    git push origin main || git push origin master || print_color $RED "Failed to push commits"
    
    # Push tag
    git push origin "$TAG_NAME" || print_color $RED "Failed to push tag"
    
    print_color $GREEN "✓ Pushed changes to remote"
    
    # GitHub release URL
    print_color $GREEN "\n==================================="
    print_color $GREEN "Release $NEW_VERSION completed!"
    print_color $GREEN "==================================="
    print_color $YELLOW "\nNext steps:"
    echo "1. Go to: https://github.com/yourusername/QueryGPT-github/releases/new"
    echo "2. Select tag: $TAG_NAME"
    echo "3. Set release title: QueryGPT $NEW_VERSION"
    echo "4. Add release notes from CHANGELOG.md"
    echo "5. Publish release"
else
    print_color $GREEN "\n==================================="
    print_color $GREEN "Release $NEW_VERSION prepared locally!"
    print_color $GREEN "==================================="
    print_color $YELLOW "\nTo push later, run:"
    echo "git push origin main"
    echo "git push origin $TAG_NAME"
fi

# Create release archive (optional)
read -p "\nDo you want to create a release archive? (y/n): " ARCHIVE_CONFIRM

if [ "$ARCHIVE_CONFIRM" == "y" ] || [ "$ARCHIVE_CONFIRM" == "Y" ]; then
    ARCHIVE_NAME="querygpt-$NEW_VERSION.tar.gz"
    print_color $YELLOW "Creating release archive: $ARCHIVE_NAME"
    
    # Create archive excluding unnecessary files
    tar -czf "$ARCHIVE_NAME" \
        --exclude='.git' \
        --exclude='*.pyc' \
        --exclude='__pycache__' \
        --exclude='venv*' \
        --exclude='*.log' \
        --exclude='cache/*' \
        --exclude='logs/*' \
        --exclude='output/*' \
        --exclude='*.db' \
        --exclude='.env' \
        .
    
    print_color $GREEN "✓ Created release archive: $ARCHIVE_NAME"
    echo "Archive size: $(du -h $ARCHIVE_NAME | cut -f1)"
fi

print_color $GREEN "\n✨ Release process completed successfully!"