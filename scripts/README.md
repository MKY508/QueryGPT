# QueryGPT Scripts

This directory contains utility scripts for version management and release automation.

## Available Scripts

### 1. release.sh
Full release automation script that handles:
- Version bumping with validation
- CHANGELOG.md updates
- Git tagging and pushing
- Release archive creation

**Usage:**
```bash
./scripts/release.sh
```

The script will prompt you for:
- New version number (format: X.Y.Z)
- Release type (major/minor/patch)
- Release notes
- Whether to push to remote
- Whether to create release archive

### 2. bump-version.sh
Quick version bumping without full release process.

**Usage:**
```bash
# Bump patch version (1.0.0 -> 1.0.1)
./scripts/bump-version.sh patch

# Bump minor version (1.0.0 -> 1.1.0)
./scripts/bump-version.sh minor

# Bump major version (1.0.0 -> 2.0.0)
./scripts/bump-version.sh major
```

### 3. check-version.sh
Verifies version consistency across all project files.

**Usage:**
```bash
./scripts/check-version.sh
```

Checks version in:
- VERSION file
- backend/__init__.py
- package.json

Also displays:
- Last Git tag
- Working directory status
- Commits since last tag

## Version Management

The project follows [Semantic Versioning](https://semver.org/):
- **Major version**: Breaking changes
- **Minor version**: New features (backward compatible)
- **Patch version**: Bug fixes

## Files Updated by Scripts

The release scripts automatically update version numbers in:
1. `/VERSION` - Single source of truth
2. `/backend/__init__.py` - Python package version
3. `/package.json` - npm package version
4. `/CHANGELOG.md` - Release history

## Release Workflow

### Standard Release Process
1. Run `./scripts/release.sh`
2. Enter new version number
3. Select release type
4. Enter release notes
5. Review and confirm changes
6. Push to remote (optional)
7. Create GitHub release manually

### Quick Patch Release
1. Run `./scripts/bump-version.sh patch`
2. Update CHANGELOG.md manually
3. Commit changes
4. Create tag: `git tag -a v1.0.1 -m "Patch release"`
5. Push: `git push origin main --tags`

## Requirements

- Bash shell
- Git
- sed command
- Basic Unix utilities (grep, cat, echo)

## Notes

- Always run scripts from the project root directory
- Ensure working directory is clean before releases
- Update CHANGELOG.md with meaningful release notes
- Test thoroughly before creating releases