#!/usr/bin/env python3
"""
UI更新测试脚本
验证新的设计系统是否正确集成
"""

import os
import sys
from pathlib import Path

def check_files():
    """检查所有必要的文件是否存在"""
    base_path = Path(__file__).parent
    
    required_files = {
        'CSS文件': [
            'frontend/static/css/design-system.css',
            'frontend/static/css/modern-style.css',
            'frontend/static/css/components.css',
            'frontend/static/css/animations.css',
        ],
        'JavaScript文件': [
            'frontend/static/js/theme-manager.js',
            'frontend/static/js/app.js',
            'frontend/static/js/api.js',
        ],
        'HTML模板': [
            'frontend/templates/index.html',
            'frontend/templates/index-modern.html',
        ]
    }
    
    print("="*50)
    print("QueryGPT UI 更新验证")
    print("="*50)
    
    all_good = True
    
    for category, files in required_files.items():
        print(f"\n检查 {category}:")
        for file in files:
            file_path = base_path / file
            if file_path.exists():
                size = file_path.stat().st_size
                print(f"  ✓ {file} ({size:,} 字节)")
            else:
                print(f"  ✗ {file} - 文件不存在!")
                all_good = False
    
    return all_good

def check_html_integration():
    """检查HTML中是否正确引入了新的资源"""
    base_path = Path(__file__).parent
    index_path = base_path / 'frontend/templates/index.html'
    
    if not index_path.exists():
        print("\n✗ index.html 不存在!")
        return False
    
    with open(index_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    print("\n检查HTML集成:")
    
    checks = {
        'design-system.css': 'design-system.css' in content,
        'modern-style.css': 'modern-style.css' in content,
        'theme-manager.js': 'theme-manager.js' in content,
        '主题切换按钮': 'theme-toggle' in content,
        '现代化类名': 'modern-layout' in content,
        'data-theme属性': 'data-theme' in content,
    }
    
    all_good = True
    for item, present in checks.items():
        if present:
            print(f"  ✓ {item} 已集成")
        else:
            print(f"  ✗ {item} 未找到")
            all_good = False
    
    return all_good

def main():
    """主函数"""
    files_ok = check_files()
    integration_ok = check_html_integration()
    
    print("\n" + "="*50)
    if files_ok and integration_ok:
        print("✓ 所有UI更新已成功实施!")
        print("\n下一步:")
        print("1. 运行 ./start.sh 启动应用")
        print("2. 访问 http://localhost:5001")
        print("3. 测试主题切换功能")
        print("4. 验证响应式布局")
        return 0
    else:
        print("✗ 存在问题，请检查上述错误")
        return 1

if __name__ == "__main__":
    sys.exit(main())