# Makefile for QueryGPT Project
# Provides convenient commands for development, testing, and deployment

.PHONY: help install test clean run docker lint format check-all

# Default target - show help
help:
	@echo "QueryGPT Development Commands"
	@echo "=============================="
	@echo ""
	@echo "Setup & Installation:"
	@echo "  make install          - Install all dependencies"
	@echo "  make install-dev      - Install development dependencies"
	@echo "  make setup            - Complete project setup"
	@echo ""
	@echo "Testing:"
	@echo "  make test             - Run all tests with coverage"
	@echo "  make test-unit        - Run unit tests only"
	@echo "  make test-integration - Run integration tests only"
	@echo "  make test-fast        - Run fast tests (no slow/integration)"
	@echo "  make test-coverage    - Generate detailed coverage report"
	@echo "  make test-watch       - Run tests in watch mode"
	@echo "  make test-specific    - Run specific test file (use TEST=path/to/test.py)"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint             - Run code linting (ruff)"
	@echo "  make format           - Format code (black + isort)"
	@echo "  make type-check       - Run type checking (mypy)"
	@echo "  make security         - Run security checks (bandit)"
	@echo "  make check-all        - Run all quality checks"
	@echo ""
	@echo "Running:"
	@echo "  make run              - Start the application"
	@echo "  make run-dev          - Start in development mode"
	@echo "  make run-debug        - Start with debug logging"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-build     - Build Docker image"
	@echo "  make docker-run       - Run in Docker container"
	@echo "  make docker-compose   - Run with docker-compose"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean            - Remove build artifacts and cache"
	@echo "  make clean-all        - Deep clean including venv"
	@echo ""
	@echo "Database:"
	@echo "  make db-init          - Initialize database"
	@echo "  make db-reset         - Reset database to clean state"
	@echo ""

# Variables
PYTHON := python3
VENV := venv_py310
VENV_PYTHON := $(VENV)/bin/python
VENV_PIP := $(VENV)/bin/pip
PROJECT_NAME := querygpt
TEST_PATH := tests
SRC_PATH := backend
COVERAGE_THRESHOLD := 80

# Check if virtual environment exists
check-venv:
	@if [ ! -d "$(VENV)" ]; then \
		echo "Virtual environment not found. Creating..."; \
		$(PYTHON) -m venv $(VENV); \
		$(VENV_PIP) install --upgrade pip; \
	fi

# Install dependencies
install: check-venv
	$(VENV_PIP) install -r requirements.txt

# Install development dependencies
install-dev: install
	$(VENV_PIP) install -r requirements-dev.txt

# Complete setup
setup: install-dev
	@echo "Setting up configuration files..."
	@if [ ! -f ".env" ]; then \
		cp .env.example .env 2>/dev/null || echo "No .env.example found"; \
	fi
	@if [ ! -f "config/config.json" ]; then \
		echo "Creating default config..."; \
		mkdir -p config; \
		echo '{"api": {"model": "gpt-3.5-turbo"}, "database": {}}' > config/config.json; \
	fi
	@echo "Setup complete!"

# ============= Testing Commands =============

# Run all tests with coverage
test: check-venv
	$(VENV_PYTHON) -m pytest --cov=$(SRC_PATH) \
		--cov-report=term-missing \
		--cov-report=html:htmlcov \
		--cov-fail-under=$(COVERAGE_THRESHOLD) \
		-v

# Run unit tests only
test-unit: check-venv
	$(VENV_PYTHON) -m pytest -m unit -v

# Run integration tests only
test-integration: check-venv
	$(VENV_PYTHON) -m pytest -m integration -v

# Run fast tests (exclude slow and integration)
test-fast: check-venv
	$(VENV_PYTHON) -m pytest -m "not slow and not integration" -v

# Run database tests
test-database: check-venv
	$(VENV_PYTHON) -m pytest -m database -v

# Run API tests
test-api: check-venv
	$(VENV_PYTHON) -m pytest -m api -v

# Run performance tests
test-performance: check-venv
	$(VENV_PYTHON) -m pytest -m performance -v

# Run smoke tests
test-smoke: check-venv
	$(VENV_PYTHON) -m pytest -m smoke -v

# Generate detailed coverage report
test-coverage: check-venv
	$(VENV_PYTHON) -m pytest --cov=$(SRC_PATH) \
		--cov-report=term-missing \
		--cov-report=html:htmlcov \
		--cov-report=xml \
		--cov-report=json \
		--cov-fail-under=$(COVERAGE_THRESHOLD)
	@echo "Coverage report generated in htmlcov/index.html"
	@echo "Opening coverage report..."
	@python -m webbrowser htmlcov/index.html 2>/dev/null || true

# Run tests in watch mode (requires pytest-watch)
test-watch: check-venv
	$(VENV_PYTHON) -m pytest_watch --clear --beep -x

# Run specific test file
test-specific: check-venv
	@if [ -z "$(TEST)" ]; then \
		echo "Usage: make test-specific TEST=path/to/test_file.py"; \
		exit 1; \
	fi
	$(VENV_PYTHON) -m pytest $(TEST) -v

# Run tests with different verbosity levels
test-quiet: check-venv
	$(VENV_PYTHON) -m pytest -q

test-verbose: check-venv
	$(VENV_PYTHON) -m pytest -vv

# ============= Code Quality Commands =============

# Run linting with ruff
lint: check-venv
	$(VENV_PYTHON) -m ruff check $(SRC_PATH) $(TEST_PATH)

# Fix linting issues automatically
lint-fix: check-venv
	$(VENV_PYTHON) -m ruff check --fix $(SRC_PATH) $(TEST_PATH)

# Format code with black
format: check-venv
	$(VENV_PYTHON) -m black $(SRC_PATH) $(TEST_PATH)
	$(VENV_PYTHON) -m isort $(SRC_PATH) $(TEST_PATH)

# Check code formatting without changes
format-check: check-venv
	$(VENV_PYTHON) -m black --check $(SRC_PATH) $(TEST_PATH)
	$(VENV_PYTHON) -m isort --check-only $(SRC_PATH) $(TEST_PATH)

# Run type checking with mypy
type-check: check-venv
	$(VENV_PYTHON) -m mypy $(SRC_PATH) --ignore-missing-imports

# Run security checks with bandit
security: check-venv
	$(VENV_PYTHON) -m bandit -r $(SRC_PATH) -ll

# Run all quality checks
check-all: lint format-check type-check security test
	@echo "All quality checks passed!"

# ============= Running Commands =============

# Start the application
run: check-venv
	$(VENV_PYTHON) backend/app.py

# Start in development mode
run-dev: check-venv
	FLASK_ENV=development FLASK_DEBUG=1 $(VENV_PYTHON) backend/app.py

# Start with debug logging
run-debug: check-venv
	LOG_LEVEL=DEBUG $(VENV_PYTHON) backend/app.py

# Start with performance monitoring
run-monitor: check-venv
	ENABLE_MONITORING=true $(VENV_PYTHON) backend/app.py

# ============= Docker Commands =============

# Build Docker image
docker-build:
	docker build -t $(PROJECT_NAME):latest .

# Run in Docker container
docker-run:
	docker run -p 5000:5000 \
		-v $(PWD)/config:/app/config \
		-v $(PWD)/data:/app/data \
		--env-file .env \
		$(PROJECT_NAME):latest

# Run with docker-compose
docker-compose:
	docker-compose up -d

# Stop docker-compose
docker-compose-down:
	docker-compose down

# View docker logs
docker-logs:
	docker-compose logs -f

# ============= Database Commands =============

# Initialize database
db-init: check-venv
	$(VENV_PYTHON) -c "from backend.database import DatabaseManager; db = DatabaseManager(); db.initialize()"

# Reset database
db-reset: check-venv
	@echo "WARNING: This will delete all data!"
	@read -p "Are you sure? (y/N): " confirm && [ "$$confirm" = "y" ] || exit 1
	rm -f backend/data/*.db data/*.db
	$(MAKE) db-init

# Run database migrations
db-migrate: check-venv
	$(VENV_PYTHON) scripts/migrate.py

# ============= Cleanup Commands =============

# Remove build artifacts and cache
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete
	find . -type f -name "*.pyd" -delete
	find . -type f -name ".coverage" -delete
	find . -type f -name "coverage.xml" -delete
	find . -type f -name "coverage.json" -delete
	rm -rf htmlcov/
	rm -rf .pytest_cache/
	rm -rf .ruff_cache/
	rm -rf .mypy_cache/
	rm -rf build/
	rm -rf dist/
	rm -rf *.egg-info
	rm -rf output/*.html 2>/dev/null || true
	rm -rf logs/*.log 2>/dev/null || true

# Deep clean including virtual environment
clean-all: clean
	rm -rf $(VENV)
	rm -rf node_modules/
	rm -f .env

# ============= Development Utilities =============

# Open Python shell with project context
shell: check-venv
	$(VENV_PYTHON) -i -c "from backend.app import *; from backend.database import *; from backend.interpreter_manager import *"

# Generate requirements from current environment
freeze: check-venv
	$(VENV_PIP) freeze > requirements-freeze.txt

# Check for dependency updates
check-updates: check-venv
	$(VENV_PIP) list --outdated

# Create a new test file from template
new-test:
	@read -p "Test name (e.g., test_feature): " name; \
	cp tests/template_test.py tests/unit/$$name.py 2>/dev/null || \
	echo "from backend import *\n\ndef test_example():\n    assert True" > tests/unit/$$name.py

# ============= CI/CD Commands =============

# Run CI pipeline locally
ci-local: check-all
	@echo "CI pipeline passed!"

# Prepare for deployment
deploy-prepare: test clean
	@echo "Checking deployment requirements..."
	$(VENV_PYTHON) scripts/check_deployment.py

# ============= Documentation =============

# Generate API documentation
docs-api: check-venv
	$(VENV_PYTHON) -m pydoc -w $(SRC_PATH)

# Serve documentation locally
docs-serve: check-venv
	$(VENV_PYTHON) -m http.server 8080 --directory docs/

# ============= Shortcuts =============

# Quick test and run
qtr: test-fast run-dev

# Quick format and test
qft: format test-fast

# Full check before commit
pre-commit: format lint test
	@echo "Ready to commit!"

# ============= Version Management =============

# Show current version
version:
	@cat VERSION 2>/dev/null || echo "0.1.0"

# Bump version
bump-version:
	@bash scripts/bump-version.sh