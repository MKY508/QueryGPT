#!/bin/bash

# Simple version bump script for QueryGPT
# Usage: ./bump-version.sh [major|minor|patch]

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get bump type
BUMP_TYPE=${1:-patch}

# Validate bump type
if [[ ! "$BUMP_TYPE" =~ ^(major|minor|patch)$ ]]; then
    echo -e "${RED}Error: Invalid bump type. Use: major, minor, or patch${NC}"
    exit 1
fi

# Get current version
if [ ! -f "VERSION" ]; then
    echo -e "${RED}Error: VERSION file not found${NC}"
    exit 1
fi

CURRENT_VERSION=$(cat VERSION)
IFS='.' read -r -a VERSION_PARTS <<< "$CURRENT_VERSION"

MAJOR=${VERSION_PARTS[0]}
MINOR=${VERSION_PARTS[1]}
PATCH=${VERSION_PARTS[2]}

# Calculate new version
case $BUMP_TYPE in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"

echo -e "${YELLOW}Bumping version from $CURRENT_VERSION to $NEW_VERSION ($BUMP_TYPE)${NC}"

# Update VERSION file
echo "$NEW_VERSION" > VERSION

# Update backend/__init__.py
if [ -f "backend/__init__.py" ]; then
    sed -i.bak "s/__version__ = \"$CURRENT_VERSION\"/__version__ = \"$NEW_VERSION\"/g" backend/__init__.py
    rm -f backend/__init__.py.bak
fi

# Update package.json
if [ -f "package.json" ]; then
    sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/g" package.json
    rm -f package.json.bak
fi

echo -e "${GREEN}✓ Version bumped to $NEW_VERSION${NC}"
echo -e "${YELLOW}Don't forget to update CHANGELOG.md and commit your changes!${NC}"