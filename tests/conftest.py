"""
Pytest configuration and shared fixtures for all tests
"""
import os
import sys
import json
import tempfile
import shutil
from pathlib import Path
from unittest.mock import Mock, MagicMock, patch
import pytest
from datetime import datetime

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Set testing environment
os.environ['TESTING'] = 'true'
os.environ['FLASK_ENV'] = 'testing'
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

# Import after environment setup
from backend.app import app as flask_app
from backend.database import DatabaseManager
from backend.interpreter_manager import InterpreterManager
from backend.history_manager import HistoryManager
from backend.config_loader import ConfigLoader


# ============= Flask App Fixtures =============

@pytest.fixture
def app():
    """Create Flask application for testing"""
    flask_app.config.update({
        'TESTING': True,
        'WTF_CSRF_ENABLED': False,
        'SECRET_KEY': 'test-secret-key',
        'DATABASE_URL': 'sqlite:///:memory:'
    })
    
    with flask_app.app_context():
        yield flask_app


@pytest.fixture
def client(app):
    """Create Flask test client"""
    return app.test_client()


@pytest.fixture
def runner(app):
    """Create Flask CLI runner"""
    return app.test_cli_runner()


@pytest.fixture
def authenticated_client(client):
    """Create an authenticated Flask test client"""
    # Mock authentication for testing
    with patch('backend.auth.require_auth', lambda f: f):
        yield client


# ============= Database Fixtures =============

@pytest.fixture
def db_manager():
    """Create a test database manager with in-memory SQLite"""
    with patch.dict(os.environ, {'DATABASE_URL': 'sqlite:///:memory:'}):
        manager = DatabaseManager()
        # Setup test schema
        with manager.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    price REAL,
                    category TEXT
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS sales (
                    id INTEGER PRIMARY KEY,
                    product_id INTEGER,
                    quantity INTEGER,
                    date TEXT,
                    FOREIGN KEY (product_id) REFERENCES products(id)
                )
            ''')
            conn.commit()
        yield manager
        # Cleanup
        manager.close_all_connections()


@pytest.fixture
def sample_data(db_manager):
    """Insert sample data into test database"""
    with db_manager.get_connection() as conn:
        cursor = conn.cursor()
        # Insert products
        products = [
            (1, 'Product A', 100.0, 'Electronics'),
            (2, 'Product B', 50.0, 'Clothing'),
            (3, 'Product C', 75.0, 'Electronics')
        ]
        cursor.executemany('INSERT INTO products VALUES (?, ?, ?, ?)', products)
        
        # Insert sales
        sales = [
            (1, 1, 5, '2024-01-01'),
            (2, 2, 10, '2024-01-02'),
            (3, 1, 3, '2024-01-03')
        ]
        cursor.executemany('INSERT INTO sales VALUES (?, ?, ?, ?)', sales)
        conn.commit()
    
    return {'products': products, 'sales': sales}


# ============= Interpreter Fixtures =============

@pytest.fixture
def mock_interpreter():
    """Create a mock interpreter for testing"""
    interpreter = MagicMock()
    interpreter.auto_run = True
    interpreter.safe_mode = 'off'
    interpreter.model = 'gpt-3.5-turbo'
    interpreter.chat = MagicMock(return_value=[
        {'role': 'assistant', 'content': 'SELECT * FROM products'},
        {'role': 'assistant', 'type': 'code', 'format': 'sql', 'content': 'SELECT * FROM products'},
        {'role': 'assistant', 'content': 'Query executed successfully'}
    ])
    return interpreter


@pytest.fixture
def interpreter_manager(mock_interpreter):
    """Create an interpreter manager with mock interpreter"""
    with patch('backend.interpreter_manager.InterpreterManager.create_interpreter', 
               return_value=mock_interpreter):
        manager = InterpreterManager()
        yield manager


# ============= Config Fixtures =============

@pytest.fixture
def test_config():
    """Create test configuration"""
    return {
        'api': {
            'base_url': 'http://test.api.com',
            'key': 'test-api-key',
            'model': 'gpt-3.5-turbo',
            'max_retries': 3,
            'timeout': 30
        },
        'database': {
            'host': 'localhost',
            'port': 3306,
            'name': 'test_db',
            'user': 'test_user',
            'password': 'test_pass'
        },
        'cache': {
            'enabled': True,
            'ttl': 3600,
            'max_size': 100
        },
        'security': {
            'enable_auth': False,
            'rate_limit': 100,
            'allowed_origins': ['http://localhost:3000']
        }
    }


@pytest.fixture
def config_file(test_config):
    """Create a temporary config file"""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(test_config, f)
        config_path = f.name
    
    yield config_path
    
    # Cleanup
    os.unlink(config_path)


@pytest.fixture
def config_loader(config_file):
    """Create a config loader with test configuration"""
    with patch('backend.config_loader.CONFIG_PATH', config_file):
        loader = ConfigLoader()
        yield loader


# ============= History Fixtures =============

@pytest.fixture
def history_manager():
    """Create a test history manager"""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, 'test_history.db')
        with patch('backend.history_manager.DATABASE_PATH', db_path):
            manager = HistoryManager()
            yield manager


@pytest.fixture
def sample_conversation(history_manager):
    """Create a sample conversation in history"""
    conversation_id = 'test-conv-123'
    messages = [
        {
            'role': 'user',
            'content': 'Show me all products'
        },
        {
            'role': 'assistant',
            'content': 'SELECT * FROM products',
            'sql': 'SELECT * FROM products'
        }
    ]
    
    for msg in messages:
        history_manager.add_message(conversation_id, msg['role'], msg['content'], 
                                   sql=msg.get('sql'))
    
    return conversation_id


# ============= Request Fixtures =============

@pytest.fixture
def api_headers():
    """Common API headers for testing"""
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Test-Client': 'pytest'
    }


@pytest.fixture
def chat_request():
    """Sample chat API request payload"""
    return {
        'message': 'Show me total sales by product',
        'conversation_id': None,
        'mode': 'normal',
        'model': 'gpt-3.5-turbo',
        'stream': False
    }


@pytest.fixture
def query_request():
    """Sample query API request payload"""
    return {
        'sql': 'SELECT * FROM products WHERE price > 50',
        'format': 'json'
    }


# ============= Mock External Services =============

@pytest.fixture
def mock_openai():
    """Mock OpenAI API responses"""
    with patch('openai.ChatCompletion.create') as mock_create:
        mock_create.return_value = {
            'choices': [{
                'message': {
                    'content': 'SELECT COUNT(*) FROM products'
                }
            }]
        }
        yield mock_create


@pytest.fixture
def mock_llm_service():
    """Mock LLM service for NLP to SQL"""
    mock_service = MagicMock()
    mock_service.generate_sql = MagicMock(
        return_value='SELECT product_id, SUM(quantity) FROM sales GROUP BY product_id'
    )
    mock_service.clarify_query = MagicMock(
        return_value='Could you specify the date range for the sales data?'
    )
    return mock_service


# ============= Utility Fixtures =============

@pytest.fixture
def temp_output_dir():
    """Create a temporary output directory"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def mock_datetime():
    """Mock datetime for consistent testing"""
    fixed_time = datetime(2024, 1, 15, 12, 0, 0)
    with patch('backend.utils.datetime') as mock_dt:
        mock_dt.now.return_value = fixed_time
        mock_dt.utcnow.return_value = fixed_time
        yield fixed_time


@pytest.fixture(autouse=True)
def cleanup_singleton():
    """Cleanup singleton instances between tests"""
    # Reset any singleton instances
    from backend.database import DatabaseManager
    from backend.interpreter_manager import InterpreterManager
    
    # Clear singleton instances if they exist
    if hasattr(DatabaseManager, '_instance'):
        delattr(DatabaseManager, '_instance')
    if hasattr(InterpreterManager, '_instance'):
        delattr(InterpreterManager, '_instance')
    
    yield
    
    # Cleanup after test
    if hasattr(DatabaseManager, '_instance'):
        delattr(DatabaseManager, '_instance')
    if hasattr(InterpreterManager, '_instance'):
        delattr(InterpreterManager, '_instance')


# ============= Performance Testing Fixtures =============

@pytest.fixture
def benchmark_timer():
    """Simple benchmark timer for performance tests"""
    import time
    
    class Timer:
        def __init__(self):
            self.times = []
        
        def __enter__(self):
            self.start = time.perf_counter()
            return self
        
        def __exit__(self, *args):
            self.end = time.perf_counter()
            self.elapsed = self.end - self.start
            self.times.append(self.elapsed)
        
        @property
        def avg(self):
            return sum(self.times) / len(self.times) if self.times else 0
        
        @property
        def total(self):
            return sum(self.times)
    
    return Timer()


# ============= Pytest Configuration =============

def pytest_configure(config):
    """Configure pytest with custom markers"""
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )
    config.addinivalue_line(
        "markers", "requires_db: marks tests that require database access"
    )
    config.addinivalue_line(
        "markers", "requires_api: marks tests that require external API access"
    )