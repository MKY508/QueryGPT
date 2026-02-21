"""Tests for database.py"""

import pytest

from app.services.database import (
    ConnectionTestResult,
    DatabaseConfig,
    DatabaseManager,
    QueryResult,
    create_database_manager,
)


class TestDatabaseConfig:
    """Test DatabaseConfig class"""

    def test_from_dict_basic(self):
        """Test creating config from dict"""
        data = {
            "driver": "mysql",
            "host": "localhost",
            "port": 3306,
            "user": "root",
            "password": "secret",
            "database": "testdb",
        }
        config = DatabaseConfig.from_dict(data)
        assert config.driver == "mysql"
        assert config.host == "localhost"
        assert config.port == 3306
        assert config.user == "root"
        assert config.password == "secret"
        assert config.database == "testdb"

    def test_from_dict_with_username(self):
        """Test creating config with username field"""
        data = {
            "driver": "postgresql",
            "username": "admin",
            "database_name": "mydb",
        }
        config = DatabaseConfig.from_dict(data)
        assert config.user == "admin"
        assert config.database == "mydb"

    def test_from_dict_defaults(self):
        """Test default values"""
        data = {"driver": "sqlite"}
        config = DatabaseConfig.from_dict(data)
        assert config.host == "localhost"
        assert config.port is None
        assert config.user == ""
        assert config.password == ""

    def test_get_port_mysql(self):
        """Test MySQL default port"""
        config = DatabaseConfig(driver="mysql")
        assert config.get_port() == 3306

    def test_get_port_postgresql(self):
        """Test PostgreSQL default port"""
        config = DatabaseConfig(driver="postgresql")
        assert config.get_port() == 5432

    def test_get_port_sqlite(self):
        """Test SQLite port"""
        config = DatabaseConfig(driver="sqlite")
        assert config.get_port() == 0

    def test_get_port_custom(self):
        """Test custom port"""
        config = DatabaseConfig(driver="mysql", port=3307)
        assert config.get_port() == 3307


class TestDatabaseManager:
    """Test DatabaseManager class"""

    def test_init_mysql(self):
        """Test MySQL manager initialization"""
        config = DatabaseConfig(driver="mysql", host="localhost", database="test")
        manager = DatabaseManager(config)
        assert manager.config.driver == "mysql"

    def test_init_postgresql(self):
        """Test PostgreSQL manager initialization"""
        config = DatabaseConfig(driver="postgresql", host="localhost", database="test")
        manager = DatabaseManager(config)
        assert manager.config.driver == "postgresql"

    def test_init_sqlite(self):
        """Test SQLite manager initialization"""
        config = DatabaseConfig(driver="sqlite", database=":memory:")
        manager = DatabaseManager(config)
        assert manager.config.driver == "sqlite"

    def test_init_unsupported_driver(self):
        """Test unsupported driver raises error"""
        config = DatabaseConfig(driver="oracle", database="test")
        with pytest.raises(ValueError, match="不支持的数据库类型"):
            DatabaseManager(config)

    def test_supported_drivers(self):
        """Test supported drivers list"""
        assert "mysql" in DatabaseManager.SUPPORTED_DRIVERS
        assert "postgresql" in DatabaseManager.SUPPORTED_DRIVERS
        assert "sqlite" in DatabaseManager.SUPPORTED_DRIVERS

    def test_read_only_prefixes(self):
        """Test read-only SQL prefixes"""
        assert "SELECT" in DatabaseManager.READ_ONLY_PREFIXES
        assert "SHOW" in DatabaseManager.READ_ONLY_PREFIXES
        assert "DESCRIBE" in DatabaseManager.READ_ONLY_PREFIXES
        assert "EXPLAIN" in DatabaseManager.READ_ONLY_PREFIXES


class TestSQLiteManager:
    """Test SQLite specific functionality"""

    @pytest.fixture
    def sqlite_manager(self, tmp_path):
        """Create SQLite manager with temp file database"""
        db_path = tmp_path / "test.db"
        config = DatabaseConfig(driver="sqlite", database=str(db_path))
        return DatabaseManager(config)

    def test_connect(self, sqlite_manager):
        """Test SQLite connection"""
        with sqlite_manager.connect() as conn:
            assert conn is not None

    def test_test_connection(self, sqlite_manager):
        """Test connection test"""
        result = sqlite_manager.test_connection()
        assert result.connected is True
        assert result.version is not None

    def test_execute_query(self, sqlite_manager):
        """Test query execution"""
        # Create a table first
        with sqlite_manager.connect() as conn:
            cursor = conn.cursor()
            cursor.execute("CREATE TABLE test (id INTEGER, name TEXT)")
            cursor.execute("INSERT INTO test VALUES (1, 'Alice')")
            cursor.execute("INSERT INTO test VALUES (2, 'Bob')")
            conn.commit()

        # Query the table
        result = sqlite_manager.execute_query("SELECT * FROM test")
        assert result.rows_count == 2
        assert len(result.data) == 2

    def test_execute_query_read_only(self, sqlite_manager):
        """Test read-only mode blocks writes"""
        # 现在会检测危险关键字 DROP，或者如果开头不是 SELECT 也会报错
        with pytest.raises(ValueError):
            sqlite_manager.execute_query("DROP TABLE test", read_only=True)

    def test_get_schema_info(self, sqlite_manager):
        """Test schema info retrieval"""
        # Create a table
        with sqlite_manager.connect() as conn:
            cursor = conn.cursor()
            cursor.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
            conn.commit()

        schema = sqlite_manager.get_schema_info()
        assert "users" in schema


class TestQueryResult:
    """Test QueryResult class"""

    def test_query_result(self):
        """Test QueryResult creation"""
        result = QueryResult(
            data=[{"id": 1, "name": "test"}],
            rows_count=1,
        )
        assert result.rows_count == 1
        assert len(result.data) == 1


class TestConnectionTestResult:
    """Test ConnectionTestResult class"""

    def test_connection_test_result_success(self):
        """Test successful connection result"""
        result = ConnectionTestResult(
            connected=True,
            version="8.0.32",
            tables_count=10,
            message="Connected successfully",
        )
        assert result.connected is True
        assert result.version == "8.0.32"

    def test_connection_test_result_failure(self):
        """Test failed connection result"""
        result = ConnectionTestResult(
            connected=False,
            message="Connection refused",
        )
        assert result.connected is False
        assert result.version is None


class TestCreateDatabaseManager:
    """Test create_database_manager factory function"""

    def test_create_from_dict(self):
        """Test creating manager from dict"""
        config = {
            "driver": "sqlite",
            "database": ":memory:",
        }
        manager = create_database_manager(config)
        assert manager.config.driver == "sqlite"

    def test_create_mysql(self):
        """Test creating MySQL manager"""
        config = {
            "driver": "mysql",
            "host": "localhost",
            "port": 3306,
            "user": "root",
            "password": "secret",
            "database": "testdb",
        }
        manager = create_database_manager(config)
        assert manager.config.driver == "mysql"
