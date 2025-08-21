#!/usr/bin/env python3
"""
QueryGPT Standalone Backend for Desktop App
简化版后端，用于 Electron 打包
"""

import os
import sys
import json
from flask import Flask, render_template, jsonify, request, send_from_directory
from flask_cors import CORS

# 设置工作目录
if getattr(sys, 'frozen', False):
    # PyInstaller 打包后的路径
    application_path = os.path.dirname(sys.executable)
else:
    application_path = os.path.dirname(os.path.abspath(__file__))

os.chdir(application_path)

# 创建 Flask 应用
app = Flask(__name__,
    template_folder='frontend/templates',
    static_folder='frontend/static'
)

CORS(app)

# 配置
app.config.update(
    SECRET_KEY=os.urandom(24),
    JSON_AS_ASCII=False,
    JSON_SORT_KEYS=False
)

@app.route('/')
def index():
    """主页面"""
    try:
        return render_template('index.html')
    except:
        return """
        <!DOCTYPE html>
        <html>
        <head>
            <title>QueryGPT</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                .container {
                    text-align: center;
                    padding: 2rem;
                }
                h1 { font-size: 3rem; margin-bottom: 1rem; }
                p { font-size: 1.2rem; opacity: 0.9; }
                .button {
                    display: inline-block;
                    margin-top: 2rem;
                    padding: 1rem 2rem;
                    background: white;
                    color: #667eea;
                    text-decoration: none;
                    border-radius: 8px;
                    font-weight: 600;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>QueryGPT</h1>
                <p>智能数据分析平台</p>
                <p style="margin-top: 2rem; font-size: 1rem;">
                    ⚠️ 桌面版正在启动中...<br>
                    完整功能需要配置数据库连接
                </p>
            </div>
        </body>
        </html>
        """

@app.route('/api/health')
def health():
    """健康检查"""
    return jsonify({
        'status': 'ok',
        'version': '1.0.0',
        'mode': 'desktop',
        'message': 'QueryGPT Desktop 运行中'
    })

@app.route('/api/config')
def get_config():
    """获取配置"""
    return jsonify({
        'app_name': 'QueryGPT',
        'version': '1.0.0',
        'features': {
            'database_query': False,  # 桌面版需要额外配置
            'visualization': True,
            'history': True
        },
        'message': '桌面版运行中，部分功能需要配置'
    })

@app.route('/api/chat', methods=['POST'])
def chat():
    """聊天接口（简化版）"""
    data = request.json
    message = data.get('message', '')
    
    # 简化的响应
    if '你好' in message or 'hello' in message.lower():
        response = "你好！我是 QueryGPT，智能数据分析助手。桌面版功能有限，完整功能需要：\n1. 配置数据库连接\n2. 安装 Python 环境和依赖\n3. 配置 LLM 服务"
    else:
        response = f"收到您的消息：{message}\n\n桌面版演示模式，完整功能请配置环境后使用。"
    
    return jsonify({
        'response': response,
        'status': 'demo',
        'conversation_id': 'desktop-demo'
    })

@app.route('/static/<path:path>')
def send_static(path):
    """静态文件"""
    return send_from_directory('frontend/static', path)

def main():
    """主函数"""
    port = int(os.environ.get('PORT', 5000))
    
    # 查找可用端口
    import socket
    for p in range(port, port + 10):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(('127.0.0.1', p))
            sock.close()
            port = p
            break
        except:
            continue
    
    print(f"QueryGPT Desktop Backend starting on port {port}")
    app.run(host='127.0.0.1', port=port, debug=False)

if __name__ == '__main__':
    main()