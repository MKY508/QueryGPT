"""
安全相关工具
- 密码哈希
- JWT Token 生成和验证
- 数据加密
"""
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from cryptography.fernet import Fernet
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

logger = structlog.get_logger()

# 密码哈希上下文 - 使用 argon2 (更安全，无长度限制)
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """生成密码哈希"""
    return pwd_context.hash(password)


def create_access_token(
    subject: str | Any,
    expires_delta: timedelta | None = None,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """创建访问令牌"""
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES
        )

    to_encode = {
        "sub": str(subject),
        "exp": expire,
        "type": "access",
    }

    if extra_claims:
        to_encode.update(extra_claims)

    return jwt.encode(
        to_encode,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def create_refresh_token(
    subject: str | Any,
    expires_delta: timedelta | None = None,
) -> str:
    """创建刷新令牌"""
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS
        )

    to_encode = {
        "sub": str(subject),
        "exp": expire,
        "type": "refresh",
    }

    return jwt.encode(
        to_encode,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def decode_token(token: str) -> dict[str, Any] | None:
    """解码并验证 Token"""
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except JWTError:
        return None


class Encryptor:
    """数据加密器 (用于加密 API Key 等敏感数据)"""

    def __init__(self, key: str | None = None):
        import base64

        if key is None:
            key = settings.ENCRYPTION_KEY

        try:
            # 尝试将 key 作为 Fernet key 使用
            key_bytes = key.encode() if isinstance(key, str) else key
            self._fernet = Fernet(key_bytes)
        except Exception:
            # 如果 key 不是有效的 Fernet key，尝试将其作为密码派生 key
            try:
                # 使用 key 的 SHA256 哈希作为 Fernet key（需要 base64 编码的 32 字节）
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


# 全局加密器实例
encryptor = Encryptor()
