# Contributing to QueryGPT

First off, thank you for considering contributing to QueryGPT! It's people like you that make QueryGPT such a great tool. We welcome contributions from everyone, regardless of their experience level.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Your First Code Contribution](#your-first-code-contribution)
  - [Pull Requests](#pull-requests)
- [Development Setup](#development-setup)
- [Style Guides](#style-guides)
  - [Python Style Guide](#python-style-guide)
  - [JavaScript Style Guide](#javascript-style-guide)
  - [Git Commit Messages](#git-commit-messages)
- [Code Review Process](#code-review-process)
- [Community](#community)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please treat everyone with respect and kindness.

### Our Standards

- Be welcoming and inclusive
- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

**How to Report a Bug:**

1. Use a clear and descriptive title
2. Describe the exact steps to reproduce the problem
3. Provide specific examples to demonstrate the steps
4. Describe the behavior you observed and explain why it's a problem
5. Explain which behavior you expected to see instead
6. Include screenshots if relevant
7. Include your environment details:
   - OS version
   - Python version
   - Node.js version (if applicable)
   - Database version

**Bug Report Template:**

```markdown
### Description
[Clear description of the bug]

### Steps to Reproduce
1. [First Step]
2. [Second Step]
3. [Additional Steps...]

### Expected Behavior
[What you expected to happen]

### Actual Behavior
[What actually happened]

### Environment
- OS: [e.g., macOS 14.0, Ubuntu 22.04]
- Python: [e.g., 3.10.5]
- Node.js: [e.g., 18.16.0]
- Database: [e.g., MySQL 8.0]

### Additional Context
[Any other information that might be helpful]
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

1. **Use a clear and descriptive title** for the issue
2. **Provide a step-by-step description** of the suggested enhancement
3. **Provide specific examples** to demonstrate the feature
4. **Describe the current behavior** and explain which behavior you expected to see instead
5. **Explain why this enhancement would be useful** to most QueryGPT users
6. **List some other tools or applications where this enhancement exists** (if applicable)

### Your First Code Contribution

Unsure where to begin contributing? You can start by looking through these issues:

- Issues labeled `good first issue` - These are issues which should only require a few lines of code
- Issues labeled `help wanted` - These issues are a bit more involved than beginner issues
- Issues labeled `documentation` - Help improve our docs!

## Development Setup

### Prerequisites

1. **Python 3.10+** (3.10.x required for OpenInterpreter integration)
2. **Node.js v18+** (for frontend development)
3. **Git**
4. **Database** (MySQL/MariaDB or compatible)

### Setting Up Your Development Environment

1. **Fork and Clone the Repository**
   ```bash
   git clone https://github.com/your-username/QueryGPT.git
   cd QueryGPT
   ```

2. **Python Environment Setup**
   ```bash
   # Create virtual environment
   python3.10 -m venv venv_py310
   source venv_py310/bin/activate  # On Windows: venv_py310\Scripts\activate
   
   # Install dependencies
   pip install -r requirements.txt
   pip install -r requirements-dev.txt  # Development dependencies
   ```

3. **Node.js Setup** (if working on frontend)
   ```bash
   # Install Node dependencies
   npm install
   ```

4. **Environment Configuration**
   ```bash
   # Copy example environment file
   cp .env.example .env
   
   # Edit .env with your configuration
   # Required: OPENAI_API_KEY, database credentials
   ```

5. **Database Setup**
   ```bash
   # Run database migrations
   python scripts/setup_database.py
   ```

6. **Verify Installation**
   ```bash
   # Run tests
   pytest
   
   # Start development server
   ./start.sh  # or python backend/app.py
   ```

## Style Guides

### Python Style Guide

We follow PEP 8 with some modifications. Our tooling enforces these standards:

#### Tools and Configuration

- **Black** - Code formatter (line length: 100)
- **Ruff** - Fast Python linter
- **mypy** - Static type checker

#### Running Code Quality Checks

```bash
# Format code
black .

# Check linting
ruff check .

# Fix linting issues automatically
ruff check . --fix

# Type checking
mypy backend/
```

#### Python Code Conventions

```python
# Good: Clear, descriptive names
def calculate_query_performance_metrics(query: str) -> Dict[str, float]:
    """Calculate performance metrics for a SQL query."""
    pass

# Bad: Unclear abbreviations
def calc_qpm(q):
    pass

# Good: Type hints for clarity
from typing import Optional, List, Dict

def process_data(
    input_data: List[Dict[str, Any]], 
    filter_criteria: Optional[str] = None
) -> List[Dict[str, Any]]:
    pass

# Good: Descriptive variable names
user_query_history = []
database_connection_pool = ConnectionPool()

# Bad: Single letter or unclear names
h = []
cp = ConnectionPool()
```

### JavaScript Style Guide

We use ESLint and Prettier for JavaScript code:

#### Tools and Configuration

- **ESLint** - Linting
- **Prettier** - Code formatting

#### Running JavaScript Quality Checks

```bash
# Lint JavaScript code
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format with Prettier
npm run format
```

#### JavaScript Code Conventions

```javascript
// Good: Use const/let, not var
const API_ENDPOINT = '/api/chat';
let userSession = null;

// Good: Arrow functions for callbacks
const processedData = data.map(item => item.value * 2);

// Good: Async/await over promises
async function fetchUserData(userId) {
    try {
        const response = await fetch(`/api/users/${userId}`);
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch user data:', error);
        throw error;
    }
}

// Good: Descriptive function and variable names
function validateSQLQuery(query) {
    // Implementation
}

// Bad: Unclear names
function validate(q) {
    // Implementation
}
```

### Git Commit Messages

We follow the Conventional Commits specification. Each commit message should be structured as follows:

```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Commit Types

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that don't affect code meaning (formatting, missing semicolons, etc.)
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **test**: Adding or updating tests
- **chore**: Changes to build process or auxiliary tools
- **perf**: Performance improvements

#### Examples

```bash
# Feature
feat(chat): add streaming response support for real-time updates

# Bug fix
fix(database): resolve connection pool timeout under high load

# Documentation
docs(api): update REST API documentation with new endpoints

# Style changes
style(frontend): format JavaScript files with Prettier

# Refactoring
refactor(backend): extract SQL validation logic to separate module

# Tests
test(integration): add tests for multi-session handling

# Build/CI
chore(deps): update Python dependencies to latest versions

# Performance
perf(cache): optimize cache key generation for 30% faster lookups
```

#### Commit Message Guidelines

1. Use the present tense ("add feature" not "added feature")
2. Use the imperative mood ("move cursor to..." not "moves cursor to...")
3. Limit the first line to 72 characters or less
4. Reference issues and pull requests liberally after the first line
5. Include motivation for the change and contrast with previous behavior

## Pull Request Process

1. **Before Creating a PR**
   - Ensure all tests pass: `pytest` and `npm test`
   - Update documentation if you're changing functionality
   - Add tests for new features
   - Ensure code follows our style guides
   - Update the CHANGELOG.md with your changes (if applicable)

2. **Creating Your Pull Request**
   - Use a clear, descriptive title
   - Reference any related issues
   - Provide a detailed description of changes
   - Include screenshots for UI changes
   - Mark as "Draft" if work is in progress

3. **PR Template**
   ```markdown
   ## Description
   Brief description of what this PR does.
   
   ## Type of Change
   - [ ] Bug fix (non-breaking change which fixes an issue)
   - [ ] New feature (non-breaking change which adds functionality)
   - [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
   - [ ] Documentation update
   
   ## How Has This Been Tested?
   Describe the tests you ran to verify your changes.
   
   ## Checklist
   - [ ] My code follows the style guidelines of this project
   - [ ] I have performed a self-review of my code
   - [ ] I have commented my code, particularly in hard-to-understand areas
   - [ ] I have made corresponding changes to the documentation
   - [ ] My changes generate no new warnings
   - [ ] I have added tests that prove my fix is effective or that my feature works
   - [ ] New and existing unit tests pass locally with my changes
   - [ ] Any dependent changes have been merged and published
   
   ## Related Issues
   Closes #(issue number)
   ```

4. **After Creating Your PR**
   - Respond to code review feedback promptly
   - Keep your branch up to date with the main branch
   - Be patient - maintainers review PRs as time permits

## Code Review Process

### What We Look For in Code Reviews

1. **Functionality**
   - Does the code do what it's supposed to do?
   - Are edge cases handled?
   - Is error handling appropriate?

2. **Code Quality**
   - Is the code readable and maintainable?
   - Does it follow our style guides?
   - Are functions and variables well-named?

3. **Performance**
   - Are there any obvious performance issues?
   - Is the approach efficient for the problem being solved?

4. **Security**
   - Are inputs properly validated?
   - Are there any SQL injection risks?
   - Are secrets properly handled?

5. **Tests**
   - Are new features covered by tests?
   - Do tests actually test the functionality?
   - Are tests maintainable?

6. **Documentation**
   - Are complex parts commented?
   - Is user-facing functionality documented?
   - Are API changes reflected in documentation?

### Review Response Guidelines

- Be respectful and constructive
- Explain the reasoning behind suggestions
- Offer alternatives when requesting changes
- Acknowledge good solutions and improvements
- Focus on the code, not the person

## Community

### Getting Help

- **GitHub Issues**: For bug reports and feature requests
- **Discussions**: For questions and general discussions
- **Documentation**: Check our docs first - your question might be answered there!

### Ways to Contribute Beyond Code

- **Improve Documentation**: Help us make our docs clearer and more comprehensive
- **Answer Questions**: Help others in issues and discussions
- **Share Your Experience**: Write blog posts or tutorials about using QueryGPT
- **Test Pre-releases**: Help us catch bugs before release
- **Translate**: Help make QueryGPT accessible to non-English speakers
- **Design**: Contribute UI/UX improvements or graphics

### Recognition

We value all contributions, not just code! Contributors are recognized in:
- Our CONTRIBUTORS.md file
- Release notes for significant contributions
- Special badges for regular contributors

## Getting Started - Quick Wins

Looking for something to work on? Here are some areas where we always appreciate help:

1. **Documentation Improvements**
   - Fix typos and grammar
   - Add examples and clarifications
   - Improve setup instructions

2. **Test Coverage**
   - Add missing tests
   - Improve test documentation
   - Add edge case tests

3. **Code Quality**
   - Fix linting warnings
   - Add type hints to Python code
   - Refactor complex functions

4. **Performance**
   - Optimize slow queries
   - Improve caching strategies
   - Reduce memory usage

5. **Accessibility**
   - Improve keyboard navigation
   - Add ARIA labels
   - Enhance color contrast

## Questions?

Don't hesitate to ask questions! Everyone was new once, and we're here to help. The only bad question is the one that goes unasked.

Thank you for contributing to QueryGPT! Your efforts help make this project better for everyone.

---

*Happy coding!* 🚀