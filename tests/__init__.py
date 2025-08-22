"""
QueryGPT Test Suite

This package contains all tests for the QueryGPT application.
Tests are organized into:
- unit/: Unit tests for individual components
- integration/: Integration tests for component interactions
- fixtures/: Shared test fixtures and utilities
"""

import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Test configuration
TEST_DATABASE_URL = os.environ.get('TEST_DATABASE_URL', 'sqlite:///:memory:')
TEST_REDIS_URL = os.environ.get('TEST_REDIS_URL', 'redis://localhost:6379/1')