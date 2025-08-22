#!/bin/bash

# Script to check version consistency across all files

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Checking version consistency...${NC}\n"

# Check VERSION file
if [ -f "VERSION" ]; then
    VERSION_FILE=$(cat VERSION)
    echo -e "VERSION file: ${GREEN}$VERSION_FILE${NC}"
else
    echo -e "VERSION file: ${RED}Not found${NC}"
fi

# Check backend/__init__.py
if [ -f "backend/__init__.py" ]; then
    PYTHON_VERSION=$(grep '__version__ = ' backend/__init__.py 2>/dev/null | sed 's/.*"\(.*\)".*/\1/' || echo "Not found")
    echo -e "backend/__init__.py: ${GREEN}$PYTHON_VERSION${NC}"
else
    echo -e "backend/__init__.py: ${RED}Not found${NC}"
fi

# Check package.json
if [ -f "package.json" ]; then
    PACKAGE_VERSION=$(grep '"version":' package.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
    echo -e "package.json: ${GREEN}$PACKAGE_VERSION${NC}"
else
    echo -e "package.json: ${RED}Not found${NC}"
fi

# Check if all versions match
echo -e "\n${YELLOW}Version consistency check:${NC}"
if [ "$VERSION_FILE" = "$PYTHON_VERSION" ] && [ "$VERSION_FILE" = "$PACKAGE_VERSION" ]; then
    echo -e "${GREEN}✓ All versions are consistent: $VERSION_FILE${NC}"
else
    echo -e "${RED}✗ Version mismatch detected!${NC}"
    echo -e "${RED}Please run: ./scripts/release.sh or ./scripts/bump-version.sh${NC}"
    exit 1
fi

# Show last release tag
echo -e "\n${YELLOW}Git information:${NC}"
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "No tags found")
echo -e "Last tag: ${GREEN}$LAST_TAG${NC}"

# Check if there are uncommitted changes
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo -e "Status: ${YELLOW}Uncommitted changes present${NC}"
else
    echo -e "Status: ${GREEN}Working directory clean${NC}"
fi

# Count commits since last tag
if [ "$LAST_TAG" != "No tags found" ]; then
    COMMITS_SINCE_TAG=$(git rev-list --count ${LAST_TAG}..HEAD 2>/dev/null || echo "0")
    echo -e "Commits since $LAST_TAG: ${GREEN}$COMMITS_SINCE_TAG${NC}"
fi