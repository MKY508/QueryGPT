"""Tests for gptme_engine.py"""

from app.services.gptme_engine import GptmeEngine, PythonSecurityAnalyzer


class TestGptmeEngine:
    """Test GptmeEngine class"""

    def test_init_default(self):
        """Test default initialization"""
        engine = GptmeEngine()
        assert engine.model is not None
        assert engine._ipython is None
        assert engine._sql_data == {}

    def test_init_custom(self):
        """Test custom initialization"""
        engine = GptmeEngine(
            model="gpt-4",
            api_key="test-key",
            base_url="https://api.test.com",
            timeout=600,
        )
        assert engine.model == "gpt-4"
        assert engine.api_key == "test-key"
        assert engine.base_url == "https://api.test.com"
        assert engine.timeout == 600

    def test_validate_python_code_safe(self):
        """Test safe Python code validation"""
        engine = GptmeEngine()

        safe_codes = [
            "import pandas as pd\ndf.head()",
            "import matplotlib.pyplot as plt\nplt.show()",
            "x = 1 + 2",
            "print('hello')",
            "df['col'].mean()",
        ]

        for code in safe_codes:
            is_valid, error = engine._validate_python_code(code)
            assert is_valid, f"Code should be safe: {code}"
            assert error is None

    def test_validate_python_code_unsafe(self):
        """Test unsafe Python code validation"""
        engine = GptmeEngine()

        unsafe_codes = [
            "import os\nos.system('rm -rf /')",
            "import subprocess\nsubprocess.run(['ls'])",
            "from os import listdir",
            "open('file.txt', 'w')",
            "exec('print(1)')",
            "eval('1+1')",
            "__import__('os')",
            "compile('code', 'file', 'exec')",
            "globals()",
            "locals()",
        ]

        for code in unsafe_codes:
            is_valid, error = engine._validate_python_code(code)
            assert not is_valid, f"Code should be unsafe: {code}"
            assert error is not None

    def test_parse_thinking(self):
        """Test thinking marker parsing"""
        engine = GptmeEngine()

        content = """
        [thinking: 分析问题]
        这是一些内容
        [thinking: 生成 SQL]
        更多内容
        [thinking: 执行查询]
        """

        thoughts = engine._parse_thinking(content)
        assert len(thoughts) == 3
        assert "分析问题" in thoughts
        assert "生成 SQL" in thoughts
        assert "执行查询" in thoughts

    def test_parse_thinking_empty(self):
        """Test thinking parsing with no markers"""
        engine = GptmeEngine()
        content = "No thinking markers here"
        thoughts = engine._parse_thinking(content)
        assert thoughts == []

    def test_extract_sql(self):
        """Test SQL extraction from content"""
        engine = GptmeEngine()

        content = """
        Here is the SQL:
        ```sql
        SELECT * FROM users WHERE id = 1;
        ```
        """

        sql = engine._extract_sql(content)
        assert sql is not None
        assert "SELECT * FROM users" in sql

    def test_extract_sql_no_block(self):
        """Test SQL extraction without code block"""
        engine = GptmeEngine()
        content = "SELECT name FROM products;"
        sql = engine._extract_sql(content)
        assert sql is not None
        assert "SELECT name FROM products" in sql

    def test_extract_sql_none(self):
        """Test SQL extraction with no SQL"""
        engine = GptmeEngine()
        content = "No SQL here, just text."
        sql = engine._extract_sql(content)
        assert sql is None

    def test_extract_python(self):
        """Test Python code extraction"""
        engine = GptmeEngine()

        content = """
        Here is the Python code:
        ```python
        import pandas as pd
        df.plot()
        ```
        """

        python = engine._extract_python(content)
        assert python is not None
        assert "import pandas" in python
        assert "df.plot()" in python

    def test_extract_python_ipython(self):
        """Test Python extraction with ipython block"""
        engine = GptmeEngine()
        content = "```ipython\nprint('hello')\n```"
        python = engine._extract_python(content)
        assert python is not None
        assert "print('hello')" in python

    def test_extract_python_none(self):
        """Test Python extraction with no Python"""
        engine = GptmeEngine()
        content = "No Python here."
        python = engine._extract_python(content)
        assert python is None

    def test_clean_content_for_display(self):
        """Test content cleaning"""
        engine = GptmeEngine()

        content = """
        [thinking: 分析中]

        这是总结内容。

        ```sql
        SELECT * FROM users;
        ```

        ```python
        df.plot()
        ```

        ```chart
        {"type": "bar"}
        ```

        更多总结。
        """

        cleaned = engine._clean_content_for_display(content)
        assert "SELECT" not in cleaned
        assert "df.plot" not in cleaned
        assert "chart" not in cleaned
        assert "[thinking:" not in cleaned
        assert "总结内容" in cleaned
        assert "更多总结" in cleaned

    def test_extract_chart_config(self):
        """Test chart config extraction"""
        engine = GptmeEngine()

        content = """
        ```chart
        {"type": "bar", "title": "Sales", "xKey": "date", "yKeys": ["amount"]}
        ```
        """

        config = engine._extract_chart_config(content)
        assert config is not None
        assert config["type"] == "bar"
        assert config["title"] == "Sales"
        assert config["xKey"] == "date"
        assert config["yKeys"] == ["amount"]

    def test_extract_chart_config_invalid_json(self):
        """Test chart config with invalid JSON"""
        engine = GptmeEngine()
        content = "```chart\n{invalid json}\n```"
        config = engine._extract_chart_config(content)
        assert config is None

    def test_extract_chart_config_none(self):
        """Test chart config with no chart block"""
        engine = GptmeEngine()
        content = "No chart here"
        config = engine._extract_chart_config(content)
        assert config is None

    def test_generate_visualization_bar(self):
        """Test auto visualization generation"""
        engine = GptmeEngine()

        data = [
            {"name": "A", "value": 10},
            {"name": "B", "value": 20},
            {"name": "C", "value": 30},
        ]

        viz = engine._generate_visualization(data, "show sales")
        assert viz is not None
        assert viz["type"] == "bar"
        assert len(viz["data"]) == 3

    def test_generate_visualization_line(self):
        """Test line chart generation for trend queries"""
        engine = GptmeEngine()

        data = [
            {"date": "2024-01", "value": 10},
            {"date": "2024-02", "value": 20},
        ]

        viz = engine._generate_visualization(data, "show trend over time")
        assert viz is not None
        assert viz["type"] == "line"

    def test_generate_visualization_pie(self):
        """Test pie chart generation"""
        engine = GptmeEngine()

        data = [
            {"category": "A", "percentage": 30},
            {"category": "B", "percentage": 70},
        ]

        viz = engine._generate_visualization(data, "show 占比")
        assert viz is not None
        assert viz["type"] == "pie"

    def test_generate_visualization_empty(self):
        """Test visualization with empty data"""
        engine = GptmeEngine()
        viz = engine._generate_visualization([], "query")
        assert viz is None

    def test_generate_visualization_single_column(self):
        """Test visualization with single column"""
        engine = GptmeEngine()
        data = [{"id": 1}, {"id": 2}]
        viz = engine._generate_visualization(data, "query")
        assert viz is None

    def test_build_chart_from_config(self):
        """Test chart building from AI config"""
        engine = GptmeEngine()

        config = {
            "type": "bar",
            "title": "Sales",
            "xKey": "date",
            "yKeys": ["amount"],
        }

        data = [
            {"date": "2024-01", "amount": 100},
            {"date": "2024-02", "amount": 200},
        ]

        chart = engine._build_chart_from_config(config, data)
        assert chart is not None
        assert chart["type"] == "bar"
        assert chart["title"] == "Sales"
        assert len(chart["data"]) == 2

    def test_build_chart_from_config_empty(self):
        """Test chart building with empty data"""
        engine = GptmeEngine()
        config = {"type": "bar"}
        chart = engine._build_chart_from_config(config, [])
        assert chart is None

    def test_build_chart_auto_detect_keys(self):
        """Test chart building with auto key detection"""
        engine = GptmeEngine()

        config = {"type": "line"}  # No xKey or yKeys
        data = [
            {"month": "Jan", "sales": 100, "profit": 20},
            {"month": "Feb", "sales": 150, "profit": 30},
        ]

        chart = engine._build_chart_from_config(config, data)
        assert chart is not None
        assert "sales" in chart["yKeys"] or "profit" in chart["yKeys"]


class TestPythonSecurityAnalyzer:
    """Test PythonSecurityAnalyzer"""

    def test_analyze_safe_code(self):
        """Test that safe code passes analysis"""
        safe_codes = [
            "import pandas as pd\ndf.head()",
            "import matplotlib.pyplot as plt\nplt.show()",
            "x = 1 + 2",
            "print('hello')",
            "df['col'].mean()",
            "import numpy as np\narr = np.array([1, 2, 3])",
        ]

        for code in safe_codes:
            is_safe, violations = PythonSecurityAnalyzer.analyze(code)
            assert is_safe, f"Code should be safe: {code}, violations: {violations}"
            assert len(violations) == 0

    def test_analyze_unsafe_imports(self):
        """Test detection of unsafe imports"""
        unsafe_codes = [
            ("import os", "os"),
            ("import sys", "sys"),
            ("import subprocess", "subprocess"),
            ("from os import listdir", "os"),
            ("from subprocess import run", "subprocess"),
        ]

        for code, expected_module in unsafe_codes:
            is_safe, violations = PythonSecurityAnalyzer.analyze(code)
            assert not is_safe, f"Code should be unsafe: {code}"
            assert any(expected_module in v for v in violations)

    def test_analyze_unsafe_builtins(self):
        """Test detection of unsafe builtin functions"""
        unsafe_codes = [
            "exec('print(1)')",
            "eval('1+1')",
            "open('file.txt', 'w')",
            "globals()",
            "locals()",
        ]

        for code in unsafe_codes:
            is_safe, violations = PythonSecurityAnalyzer.analyze(code)
            assert not is_safe, f"Code should be unsafe: {code}"

    def test_analyze_dangerous_attributes(self):
        """Test detection of dangerous attribute access"""
        unsafe_codes = [
            "__builtins__.__import__('os')",
            "func.__globals__",
            "func.__locals__",
        ]

        for code in unsafe_codes:
            is_safe, violations = PythonSecurityAnalyzer.analyze(code)
            assert not is_safe, f"Code should be unsafe: {code}"

    def test_analyze_syntax_error(self):
        """Test handling of syntax errors"""
        is_safe, violations = PythonSecurityAnalyzer.analyze("import os")
        # This should not raise an exception
        assert isinstance(is_safe, bool)
        assert isinstance(violations, list)
