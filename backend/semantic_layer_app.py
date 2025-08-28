"""
语义层独立应用
与主应用分离，避免影响核心功能
"""

from flask import Flask
from flask_cors import CORS
import os
import sys
import logging

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 创建独立的Flask应用
app = Flask(__name__)
CORS(app, resources={r"/api/semantic/*": {"origins": ["http://localhost:*", "http://127.0.0.1:*"]}})

def init_semantic_layer():
    """初始化语义层"""
    try:
        from backend.semantic_layer.api import semantic_bp
        app.register_blueprint(semantic_bp)
        logger.info("语义层路由已注册")
        return True
    except Exception as e:
        logger.error(f"语义层初始化失败: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    if init_semantic_layer():
        # 在不同端口运行，避免冲突
        app.run(host='0.0.0.0', port=5001, debug=False)
    else:
        logger.error("语义层启动失败")