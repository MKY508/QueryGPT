"""安全相关工具"""

import structlog
from cryptography.fernet import Fernet

from app.core.config import settings

logger = structlog.get_logger()


class Encryptor:
    """数据加密器 (用于加密 API Key 等敏感数据)"""

    def __init__(self, key: str | None = None):
        import base64

        if key is None:
            key = settings.ENCRYPTION_KEY

        try:
            key_bytes = key.encode() if isinstance(key, str) else key
            self._fernet = Fernet(key_bytes)
        except Exception:
            try:
                import hashlib

                key_hash = hashlib.sha256(key.encode()).digest()
                fernet_key = base64.urlsafe_b64encode(key_hash)
                self._fernet = Fernet(fernet_key)
                logger.warning("使用派生密钥，建议设置有效的 Fernet key")
            except Exception as e:
                raise ValueError(f"无法初始化加密器: {e}。请设置有效的 ENCRYPTION_KEY")

    def encrypt(self, plaintext: str) -> str:
        """加密字符串"""
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        """解密字符串"""
        return self._fernet.decrypt(ciphertext.encode()).decode()


def mask_secret(value: str | None) -> str | None:
    """隐藏敏感值，避免日志泄露完整内容"""
    if not value:
        return None
    if len(value) <= 6:
        return "*" * len(value)
    return f"{value[:3]}***{value[-3:]}"


encryptor = Encryptor()

__all__: list[str] = ["encryptor", "Encryptor", "mask_secret"]
