#!/usr/bin/env python3
"""
库兼容性验证脚本
验证所有依赖库在当前环境中是否正常工作
"""

import sys
import platform
import importlib

def check_environment():
    """检查运行环境"""
    print("=" * 50)
    print("环境信息")
    print("=" * 50)
    print(f"Python 版本: {sys.version}")
    print(f"平台: {platform.platform()}")
    print(f"架构: {platform.machine()}")
    print(f"处理器: {platform.processor()}")
    
    # 检测 WSL
    try:
        with open('/proc/version', 'r') as f:
            if 'microsoft' in f.read().lower():
                print("环境: Windows WSL")
    except:
        pass
    print()

def check_library(name, import_name=None, test_func=None):
    """
    检查单个库
    name: 库名称
    import_name: 导入名称（如果与库名不同）
    test_func: 测试函数
    """
    import_name = import_name or name
    
    try:
        module = importlib.import_module(import_name)
        version = getattr(module, '__version__', 'unknown')
        
        # 运行测试函数
        test_result = "✓"
        if test_func:
            try:
                test_func(module)
            except Exception as e:
                test_result = f"⚠ 功能测试失败: {e}"
        
        print(f"✓ {name:20} v{version:10} {test_result}")
        return True
    except ImportError as e:
        print(f"✗ {name:20} 未安装: {e}")
        return False
    except Exception as e:
        print(f"⚠ {name:20} 导入错误: {e}")
        return False

def test_numpy(np):
    """测试 NumPy 基本功能"""
    arr = np.array([1, 2, 3])
    assert arr.sum() == 6
    # 测试 BLAS（架构相关）
    a = np.random.rand(100, 100)
    b = np.random.rand(100, 100)
    c = np.dot(a, b)  # 矩阵乘法

def test_pandas(pd):
    """测试 Pandas 基本功能"""
    df = pd.DataFrame({'a': [1, 2, 3], 'b': [4, 5, 6]})
    assert df['a'].sum() == 6

def test_flask(flask):
    """测试 Flask 基本功能"""
    app = flask.Flask(__name__)
    assert app is not None

def test_pymysql(pymysql):
    """测试 PyMySQL（不连接数据库）"""
    # 只测试导入，不实际连接
    assert hasattr(pymysql, 'connect')

def test_cryptography(cryptography):
    """测试 cryptography（架构敏感）"""
    from cryptography.fernet import Fernet
    key = Fernet.generate_key()
    f = Fernet(key)
    token = f.encrypt(b"test message")
    assert f.decrypt(token) == b"test message"

def test_openinterpreter():
    """测试 OpenInterpreter"""
    try:
        import interpreter
        # 不实际运行，只检查导入
        assert hasattr(interpreter, 'chat')
        return True
    except:
        return False

def main():
    check_environment()
    
    print("=" * 50)
    print("核心库检查")
    print("=" * 50)
    
    # 定义要检查的库
    libraries = [
        # (库名, 导入名, 测试函数)
        ("flask", None, test_flask),
        ("flask-cors", "flask_cors", None),
        ("pymysql", None, test_pymysql),
        ("python-dotenv", "dotenv", None),
        ("pyyaml", "yaml", None),
        ("plotly", None, None),
        ("flasgger", None, None),
        ("aiohttp", None, None),
    ]
    
    success_count = 0
    for lib_info in libraries:
        if len(lib_info) == 3:
            name, import_name, test_func = lib_info
        else:
            name, import_name = lib_info
            test_func = None
        
        if check_library(name, import_name, test_func):
            success_count += 1
    
    print()
    print("=" * 50)
    print("架构敏感库检查（C 扩展）")
    print("=" * 50)
    
    # 这些库包含 C 扩展，架构敏感
    arch_sensitive = [
        ("numpy", None, test_numpy),
        ("pandas", None, test_pandas),
        ("cryptography", None, test_cryptography),
    ]
    
    for name, import_name, test_func in arch_sensitive:
        check_library(name, import_name, test_func)
    
    print()
    print("=" * 50)
    print("OpenInterpreter 检查")
    print("=" * 50)
    
    if test_openinterpreter():
        print("✓ OpenInterpreter 可用")
    else:
        print("✗ OpenInterpreter 不可用")
        print("  提示: 需要 Python 3.10.x")
    
    print()
    print("=" * 50)
    print("兼容性总结")
    print("=" * 50)
    
    # 检查架构特定问题
    arch = platform.machine().lower()
    if 'arm' in arch or 'aarch' in arch:
        print("⚠ ARM 架构注意事项:")
        print("  • NumPy/Pandas 可能需要从源码编译")
        print("  • 性能可能与 x86 有差异")
        print("  • 某些优化可能不可用")
    elif 'x86' in arch or 'amd64' in arch:
        print("✓ x86_64 架构:")
        print("  • 所有库都有预编译版本")
        print("  • 性能优化完整")
    
    # Windows WSL 特定
    try:
        with open('/proc/version', 'r') as f:
            if 'microsoft' in f.read().lower():
                print()
                print("⚠ Windows WSL 注意事项:")
                print("  • 使用 Windows 的 localhost 访问服务")
                print("  • 文件系统性能可能较慢")
                print("  • 某些网络功能可能受限")
    except:
        pass
    
    print()
    print("✅ 库的用法在所有架构上都相同")
    print("✅ API 接口完全一致，只是底层实现不同")
    print("✅ 如果所有库都显示 ✓，则可以正常运行")

if __name__ == "__main__":
    main()