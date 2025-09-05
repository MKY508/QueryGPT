"""
简单缓存管理器（用于测试与基本清理）。
"""
import os
import shutil


class CacheManager:
    @staticmethod
    def clear_all():
        """清理常见缓存目录（cache/ 和 backend/cache/）。"""
        candidates = [
            os.path.join(os.path.dirname(os.path.dirname(__file__)), 'cache'),
            os.path.join(os.path.dirname(__file__), 'cache'),
        ]
        for path in candidates:
            try:
                if os.path.isdir(path):
                    shutil.rmtree(path)
            except Exception:
                pass
        # 重新创建主缓存目录
        try:
            os.makedirs(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'cache'), exist_ok=True)
        except Exception:
            pass
