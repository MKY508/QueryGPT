#!/usr/bin/env python3
"""
提取 i18n.js 中的语言文件为独立的 JSON 文件
使用 Python 更安全地解析 JavaScript 对象
"""

import json
import re
import os
from pathlib import Path

# 路径配置
script_dir = Path(__file__).parent
project_root = script_dir.parent
i18n_js_path = project_root / 'frontend/static/js/i18n.js'
locales_dir = project_root / 'frontend/static/js/locales'

# 确保 locales 目录存在
locales_dir.mkdir(parents=True, exist_ok=True)

# 读取 i18n.js 文件
with open(i18n_js_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 找到 i18n 对象的开始和结束位置
i18n_start = content.find('const i18n = {')
if i18n_start == -1:
    print('❌ Could not find i18n object')
    exit(1)

# 找到 LanguageManager 类的位置（这是 i18n 对象的结束标志）
class_start = content.find('class LanguageManager')
if class_start == -1:
    print('❌ Could not find LanguageManager class')
    exit(1)

# 提取 i18n 对象部分
i18n_obj_str = content[i18n_start + len('const i18n = '):class_start].strip()
# 移除末尾的分号
i18n_obj_str = re.sub(r';\s*$', '', i18n_obj_str)

# 定义要提取的语言列表
languages = ['en', 'ru', 'pt', 'es', 'fr', 'ko', 'de', 'ja']

print('Extracting language files...\n')

for lang in languages:
    # 查找语言对象的开始位置
    lang_pattern = re.compile(rf'\s+{re.escape(lang)}:\s*{{')
    match = lang_pattern.search(i18n_obj_str)
    
    if not match:
        print(f'⚠ Language {lang} not found')
        continue
    
    start_idx = match.start()
    
    # 找到第一个 { 的位置
    obj_start = start_idx + len(match.group()) - 1
    for i in range(obj_start, len(i18n_obj_str)):
        if i18n_obj_str[i] == '{':
            obj_start = i
            break
    
    # 查找匹配的结束大括号
    brace_count = 0
    in_string = False
    string_char = None
    escape_next = False
    
    for i in range(obj_start, len(i18n_obj_str)):
        char = i18n_obj_str[i]
        
        if escape_next:
            escape_next = False
            continue
        
        if char == '\\':
            escape_next = True
            continue
        
        if not in_string and char in ('"', "'", '`'):
            in_string = True
            string_char = char
            continue
        
        if in_string and char == string_char:
            in_string = False
            string_char = None
            continue
        
        if not in_string:
            if char == '{':
                brace_count += 1
            elif char == '}':
                brace_count -= 1
                if brace_count == 0:
                    # 找到匹配的结束大括号
                    end_idx = i + 1
                    lang_obj_str = i18n_obj_str[obj_start:end_idx]
                    
                    # 尝试解析为 JSON
                    try:
                        # 先尝试直接解析（如果格式正确）
                        lang_data = json.loads(lang_obj_str)
                        
                        # 保存为 JSON 文件
                        json_path = locales_dir / f'{lang}.json'
                        with open(json_path, 'w', encoding='utf-8') as f:
                            json.dump(lang_data, f, ensure_ascii=False, indent=2)
                        print(f'✓ Extracted {lang}.json')
                    except json.JSONDecodeError:
                        # 如果直接解析失败，尝试使用 JavaScript 解析器
                        # 这里我们使用一个更简单的方法：使用 node 来解析
                        import subprocess
                        import tempfile
                        
                        try:
                            # 创建一个临时 JS 文件
                            with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as tmp:
                                tmp.write(f'console.log(JSON.stringify({lang_obj_str}))')
                                tmp_path = tmp.name
                            
                            # 使用 node 执行
                            result = subprocess.run(
                                ['node', tmp_path],
                                capture_output=True,
                                text=True,
                                timeout=5
                            )
                            
                            if result.returncode == 0:
                                lang_data = json.loads(result.stdout.strip())
                                
                                # 保存为 JSON 文件
                                json_path = locales_dir / f'{lang}.json'
                                with open(json_path, 'w', encoding='utf-8') as f:
                                    json.dump(lang_data, f, ensure_ascii=False, indent=2)
                                print(f'✓ Extracted {lang}.json')
                            else:
                                print(f'✗ Failed to extract {lang}: {result.stderr}')
                        except Exception as e:
                            print(f'✗ Failed to extract {lang}: {str(e)}')
                        finally:
                            # 清理临时文件
                            try:
                                os.unlink(tmp_path)
                            except:
                                pass
                    break

print('\n✅ Language extraction completed!')
print(f'📁 Files saved to: {locales_dir}')

