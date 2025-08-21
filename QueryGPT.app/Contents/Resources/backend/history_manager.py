"""
历史记录管理器
处理对话历史的保存、加载、搜索和复现
"""

import json
import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from pathlib import Path
import hashlib
import re

class HistoryManager:
    """
    对话历史管理器
    
    管理所有查询历史、对话记录和会话状态。
    使用SQLite数据库存储，支持分页、搜索和统计功能。
    
    Attributes:
        db_path (str): 数据库文件路径
        
    Example:
        >>> manager = HistoryManager()
        >>> conversation_id = manager.create_conversation(
        ...     title="销售数据查询",
        ...     model="gpt-4.1"
        ... )
        >>> manager.add_message(conversation_id, "user", "查询本月销售")
    """
    
    def __init__(self, db_path: str = "backend/data/history.db"):
        """
        初始化历史管理器。
        
        Args:
            db_path: 数据库文件路径，默认为 backend/data/history.db
        """
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_database()
        
    def _init_database(self):
        """初始化数据库结构"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # 创建对话表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    duration INTEGER DEFAULT 0,
                    model TEXT,
                    database_name TEXT,
                    total_tokens INTEGER DEFAULT 0,
                    tags TEXT,
                    is_favorite BOOLEAN DEFAULT 0,
                    query_count INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'active'
                )
            """)
            
            # 创建消息表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT,
                    type TEXT,
                    content TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    context TEXT,
                    execution_details TEXT,
                    tokens_used INTEGER DEFAULT 0,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                )
            """)
            
            # 创建会话状态表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS session_states (
                    conversation_id TEXT PRIMARY KEY,
                    interpreter_config TEXT,
                    environment_vars TEXT,
                    working_directory TEXT,
                    loaded_modules TEXT,
                    custom_functions TEXT,
                    state_snapshot TEXT,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                )
            """)
            
            # 创建查询模板表（用于识别相似查询）
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS query_templates (
                    id TEXT PRIMARY KEY,
                    template_hash TEXT UNIQUE,
                    template_pattern TEXT,
                    usage_count INTEGER DEFAULT 1,
                    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    average_execution_time REAL,
                    success_rate REAL
                )
            """)
            
            # 创建索引以提升查询性能
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_conversations_updated 
                ON conversations(updated_at DESC)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_messages_conversation 
                ON messages(conversation_id, timestamp)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_conversations_favorite 
                ON conversations(is_favorite, updated_at DESC)
            """)
            
            conn.commit()
    
    def create_conversation(self, title: Optional[str] = None, 
                          model: str = "gpt-4", 
                          database_name: Optional[str] = None) -> str:
        """
        创建新的对话会话
        
        Args:
            title: 对话标题
            model: 使用的模型
            database_name: 数据库名称
            
        Returns:
            conversation_id: 对话ID
        """
        conversation_id = str(uuid.uuid4())
        
        if not title:
            title = f"对话 {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO conversations (id, title, model, database_name)
                VALUES (?, ?, ?, ?)
            """, (conversation_id, title, model, database_name))
            conn.commit()
        
        return conversation_id
    
    def add_message(self, conversation_id: str, message_type: str, 
                   content: str, context: Optional[Dict] = None,
                   execution_details: Optional[Dict] = None) -> str:
        """
        添加消息到对话
        
        Args:
            conversation_id: 对话ID
            message_type: 消息类型 (user/assistant/system)
            content: 消息内容
            context: 上下文信息
            execution_details: 执行细节
            
        Returns:
            message_id: 消息ID
        """
        message_id = str(uuid.uuid4())
        
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # 插入消息
            cursor.execute("""
                INSERT INTO messages (id, conversation_id, type, content, 
                                    context, execution_details)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                message_id,
                conversation_id,
                message_type,
                content,
                json.dumps(context) if context else None,
                json.dumps(execution_details) if execution_details else None
            ))
            
            # 更新对话的更新时间和查询计数
            cursor.execute("""
                UPDATE conversations 
                SET updated_at = CURRENT_TIMESTAMP,
                    query_count = query_count + 1
                WHERE id = ?
            """, (conversation_id,))
            
            conn.commit()
        
        # 提取并保存查询模板
        if message_type == "user":
            self._extract_query_template(content)
        
        return message_id
    
    def _extract_query_template(self, query: str):
        """
        提取查询模板用于相似查询识别
        
        Args:
            query: 用户查询
        """
        # 移除具体的数值、日期等，保留查询结构
        template = re.sub(r'\d{4}[-年]\d{1,2}[-月]?\d{0,2}[日]?', '{日期}', query)
        template = re.sub(r'\d+', '{数字}', template)
        template = re.sub(r'[\'"][^\'"]+[\'"]', '{字符串}', template)
        
        # 生成模板哈希
        template_hash = hashlib.md5(template.encode()).hexdigest()
        
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # 检查模板是否存在
            cursor.execute("""
                SELECT id, usage_count FROM query_templates 
                WHERE template_hash = ?
            """, (template_hash,))
            
            result = cursor.fetchone()
            
            if result:
                # 更新使用次数
                cursor.execute("""
                    UPDATE query_templates 
                    SET usage_count = usage_count + 1,
                        last_used = CURRENT_TIMESTAMP
                    WHERE template_hash = ?
                """, (template_hash,))
            else:
                # 插入新模板
                template_id = str(uuid.uuid4())
                cursor.execute("""
                    INSERT INTO query_templates (id, template_hash, template_pattern)
                    VALUES (?, ?, ?)
                """, (template_id, template_hash, template))
            
            conn.commit()
    
    def get_conversation_history(self, conversation_id: str, 
                                limit: Optional[int] = None) -> Dict:
        """
        获取对话历史
        
        Args:
            conversation_id: 对话ID
            limit: 限制返回的消息数量
            
        Returns:
            对话历史数据
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # 获取对话信息
            cursor.execute("""
                SELECT * FROM conversations WHERE id = ?
            """, (conversation_id,))
            
            conversation = cursor.fetchone()
            if not conversation:
                return None
            
            # 获取消息历史
            query = """
                SELECT * FROM messages 
                WHERE conversation_id = ? 
                ORDER BY timestamp ASC
            """
            
            if limit:
                query += f" LIMIT {limit}"
            
            cursor.execute(query, (conversation_id,))
            messages = cursor.fetchall()
            
            # 获取会话状态
            cursor.execute("""
                SELECT * FROM session_states WHERE conversation_id = ?
            """, (conversation_id,))
            
            session_state = cursor.fetchone()
            
            # 构建返回数据
            result = {
                "conversation_id": conversation_id,
                "metadata": {
                    "title": conversation["title"],
                    "created_at": conversation["created_at"],
                    "updated_at": conversation["updated_at"],
                    "model": conversation["model"],
                    "database": conversation["database_name"],
                    "total_tokens": conversation["total_tokens"],
                    "query_count": conversation["query_count"],
                    "is_favorite": bool(conversation["is_favorite"]),
                    "tags": json.loads(conversation["tags"]) if conversation["tags"] else []
                },
                "messages": []
            }
            
            # 处理消息
            for msg in messages:
                message_data = {
                    "id": msg["id"],
                    "type": msg["type"],
                    "content": msg["content"],
                    "timestamp": msg["timestamp"]
                }
                
                if msg["context"]:
                    message_data["context"] = json.loads(msg["context"])
                
                if msg["execution_details"]:
                    message_data["execution"] = json.loads(msg["execution_details"])
                
                result["messages"].append(message_data)
            
            # 添加会话状态
            if session_state:
                result["session_state"] = {
                    "interpreter_config": json.loads(session_state["interpreter_config"]) 
                        if session_state["interpreter_config"] else None,
                    "environment_vars": json.loads(session_state["environment_vars"])
                        if session_state["environment_vars"] else None,
                    "working_directory": session_state["working_directory"]
                }
            
            return result
    
    def search_conversations(self, query: str = "", 
                           start_date: Optional[datetime] = None,
                           end_date: Optional[datetime] = None,
                           tags: Optional[List[str]] = None,
                           limit: int = 50) -> List[Dict]:
        """
        搜索对话历史
        
        Args:
            query: 搜索关键词
            start_date: 开始日期
            end_date: 结束日期
            tags: 标签过滤
            limit: 返回数量限制
            
        Returns:
            匹配的对话列表
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # 构建查询
            conditions = []
            params = []
            
            if query:
                conditions.append("""
                    (c.title LIKE ? OR EXISTS (
                        SELECT 1 FROM messages m 
                        WHERE m.conversation_id = c.id 
                        AND m.content LIKE ?
                    ))
                """)
                params.extend([f"%{query}%", f"%{query}%"])
            
            if start_date:
                conditions.append("c.created_at >= ?")
                params.append(start_date.isoformat())
            
            if end_date:
                conditions.append("c.created_at <= ?")
                params.append(end_date.isoformat())
            
            where_clause = " AND ".join(conditions) if conditions else "1=1"
            
            cursor.execute(f"""
                SELECT c.*, 
                       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count,
                       (SELECT m.content FROM messages m 
                        WHERE m.conversation_id = c.id AND m.type = 'user'
                        ORDER BY m.timestamp DESC LIMIT 1) as last_query
                FROM conversations c
                WHERE {where_clause}
                ORDER BY c.updated_at DESC
                LIMIT ?
            """, params + [limit])
            
            conversations = []
            for row in cursor.fetchall():
                conversations.append({
                    "id": row["id"],
                    "title": row["title"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                    "message_count": row["message_count"],
                    "last_query": row["last_query"],
                    "is_favorite": bool(row["is_favorite"]),
                    "model": row["model"],
                    "database": row["database_name"]
                })
            
            return conversations
    
    def get_recent_conversations(self, limit: int = 20) -> List[Dict]:
        """
        获取最近的对话
        
        Args:
            limit: 返回数量
            
        Returns:
            最近的对话列表
        """
        return self.search_conversations(limit=limit)
    
    def get_favorite_conversations(self) -> List[Dict]:
        """
        获取收藏的对话
        
        Returns:
            收藏的对话列表
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT * FROM conversations 
                WHERE is_favorite = 1
                ORDER BY updated_at DESC
            """)
            
            return [dict(row) for row in cursor.fetchall()]
    
    def toggle_favorite(self, conversation_id: str) -> bool:
        """
        切换收藏状态
        
        Args:
            conversation_id: 对话ID
            
        Returns:
            新的收藏状态
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE conversations 
                SET is_favorite = NOT is_favorite
                WHERE id = ?
            """, (conversation_id,))
            
            conn.commit()
            
            cursor.execute("""
                SELECT is_favorite FROM conversations WHERE id = ?
            """, (conversation_id,))
            
            result = cursor.fetchone()
            return bool(result[0]) if result else False
    
    def delete_conversation(self, conversation_id: str):
        """
        删除对话
        
        Args:
            conversation_id: 对话ID
        
        Returns:
            bool: 是否成功删除
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # 先检查对话是否存在
                cursor.execute("SELECT COUNT(*) FROM conversations WHERE id = ?", 
                             (conversation_id,))
                count = cursor.fetchone()[0]
                
                if count == 0:
                    print(f"警告：对话 {conversation_id} 不存在")
                    return False
                
                # 删除相关数据
                cursor.execute("DELETE FROM messages WHERE conversation_id = ?", 
                             (conversation_id,))
                messages_deleted = cursor.rowcount
                
                cursor.execute("DELETE FROM session_states WHERE conversation_id = ?", 
                             (conversation_id,))
                states_deleted = cursor.rowcount
                
                cursor.execute("DELETE FROM conversations WHERE id = ?", 
                             (conversation_id,))
                conv_deleted = cursor.rowcount
                
                conn.commit()
                
                print(f"成功删除对话 {conversation_id}: "
                      f"删除了 {messages_deleted} 条消息, "
                      f"{states_deleted} 个状态, "
                      f"{conv_deleted} 个对话")
                
                return conv_deleted > 0
                
        except Exception as e:
            print(f"删除对话失败 {conversation_id}: {e}")
            raise
    
    def cleanup_old_conversations(self, days: int = 90):
        """
        清理旧对话
        
        Args:
            days: 保留最近N天的对话
        """
        cutoff_date = datetime.now() - timedelta(days=days)
        
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # 获取要删除的对话ID
            cursor.execute("""
                SELECT id FROM conversations 
                WHERE updated_at < ? AND is_favorite = 0
            """, (cutoff_date.isoformat(),))
            
            conversation_ids = [row[0] for row in cursor.fetchall()]
            
            # 删除相关数据
            for conv_id in conversation_ids:
                self.delete_conversation(conv_id)
    
    def get_statistics(self) -> Dict:
        """
        获取历史统计信息
        
        Returns:
            统计数据
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            stats = {}
            
            # 总对话数
            cursor.execute("SELECT COUNT(*) FROM conversations")
            stats["total_conversations"] = cursor.fetchone()[0]
            
            # 总消息数
            cursor.execute("SELECT COUNT(*) FROM messages")
            stats["total_messages"] = cursor.fetchone()[0]
            
            # 今日对话数
            today = datetime.now().date()
            cursor.execute("""
                SELECT COUNT(*) FROM conversations 
                WHERE DATE(created_at) = ?
            """, (today,))
            stats["today_conversations"] = cursor.fetchone()[0]
            
            # 常用查询模板
            cursor.execute("""
                SELECT template_pattern, usage_count 
                FROM query_templates 
                ORDER BY usage_count DESC 
                LIMIT 5
            """)
            stats["popular_templates"] = [
                {"pattern": row[0], "count": row[1]} 
                for row in cursor.fetchall()
            ]
            
            return stats
    
    def save_session_state(self, conversation_id: str, state: Dict):
        """
        保存会话状态
        
        Args:
            conversation_id: 对话ID
            state: 状态数据
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT OR REPLACE INTO session_states 
                (conversation_id, interpreter_config, environment_vars, 
                 working_directory, loaded_modules, custom_functions, state_snapshot)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                conversation_id,
                json.dumps(state.get("interpreter_config")),
                json.dumps(state.get("environment_vars")),
                state.get("working_directory"),
                json.dumps(state.get("loaded_modules")),
                json.dumps(state.get("custom_functions")),
                json.dumps(state.get("state_snapshot"))
            ))
            
            conn.commit()