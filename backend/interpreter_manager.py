"""
OpenInterpreter Manager Module
使用OpenInterpreter 0.4.3版本管理AI会话
"""
import os
import json
from typing import Dict, Any, Optional
from interpreter import OpenInterpreter
import logging
from backend.config_loader import ConfigLoader
from backend.query_clarifier import SmartQueryProcessor
import time
from threading import Lock

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class InterpreterManager:
    """管理OpenInterpreter会话"""
    
    def __init__(self, config_path: str = None):
        """初始化管理器"""
        # 从.env文件加载配置
        api_config = ConfigLoader.get_api_config()
        self.config = {
            "models": api_config["models"],
            "current_model": api_config["default_model"]
        }
        self._clear_proxy_env()
        
        # 会话缓存：存储活跃的interpreter实例
        self._session_cache = {}
        # 会话最后活跃时间
        self._session_last_active = {}
        # 会话锁，避免并发问题
        self._session_lock = Lock()
        # 会话超时时间（秒）
        self.session_timeout = 1800  # 30分钟
        
        # 会话历史存储（内存中，重启后清空）
        self._conversation_history = {}
        # 最大历史轮数（防止上下文过长）
        self.max_history_rounds = 3
        
    def _clear_proxy_env(self):
        """清除代理环境变量，避免LiteLLM冲突"""
        proxy_vars = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']
        for var in proxy_vars:
            os.environ.pop(var, None)
        logger.info("已清除代理环境变量")
        
    
    def create_interpreter(self, model_name: Optional[str] = None) -> OpenInterpreter:
        """
        创建新的Interpreter实例
        每次创建新实例以避免状态污染
        """
        model_name = model_name or self.config.get("current_model", "gpt-4.1")
        model_config = self.config.get("models", {}).get(model_name)
        
        if not model_config:
            raise ValueError(f"模型配置不存在: {model_name}")
        
        # 创建新的OpenInterpreter实例
        interpreter = OpenInterpreter()
        
        # 配置LLM设置（OpenInterpreter 0.4.3 API）
        interpreter.llm.api_key = model_config.get("api_key")
        interpreter.llm.api_base = model_config.get("base_url")
        interpreter.llm.model = model_config.get("model_name")
        
        # 配置安全设置
        interpreter.auto_run = True  # 自动执行代码
        interpreter.safe_mode = "off"  # 关闭安全模式以执行所有代码
        
        # 设置系统消息
        interpreter.system_message = """
        你是一个数据分析助手。请帮助用户查询数据库并生成可视化。
        使用pandas处理数据，使用plotly创建图表。
        将结果保存为HTML文件到output目录。
        """
        
        logger.info(f"创建了新的Interpreter实例，使用模型: {model_name}")
        return interpreter
    
    def execute_query(self, query: str, context: Dict[str, Any] = None, 
                     model_name: Optional[str] = None, conversation_id: Optional[str] = None,
                     stop_checker: Optional[callable] = None) -> Dict[str, Any]:
        """
        执行查询并返回结果，支持会话上下文和中断
        """
        try:
            # 先检查查询是否需要澄清
            processor = SmartQueryProcessor()
            clarification_result = processor.process(query)
            
            if clarification_result['status'] == 'needs_clarification':
                # 需要澄清，返回友好提示
                clarification_msg = processor.format_clarification_response(clarification_result)
                logger.info(f"查询需要澄清: {query[:50]}...")
                
                return {
                    "success": True,
                    "needs_clarification": True,
                    "result": {
                        "content": [{
                            "type": "text",
                            "content": clarification_msg
                        }]
                    },
                    "model": model_name or self.config.get("current_model"),
                    "conversation_id": conversation_id
                }
            
            # 使用增强后的查询
            enhanced_query = clarification_result.get('query', query)
            # 创建新的interpreter实例
            interpreter = self.create_interpreter(model_name)
            
            # 获取会话历史（如果有）
            conversation_history = None
            if conversation_id:
                conversation_history = self._get_conversation_history(conversation_id)
            
            # 构建包含历史的提示词（使用增强后的查询）
            full_prompt = self._build_prompt_with_context(enhanced_query, context, conversation_history)
            
            # 存储当前的interpreter以便停止
            if conversation_id:
                with self._session_lock:
                    self._session_cache[conversation_id] = interpreter
            
            # 执行查询
            logger.info(f"执行查询: {query[:100]}... (会话ID: {conversation_id})")
            
            # 检查是否需要停止
            if stop_checker and stop_checker():
                logger.info(f"查询被用户中断: {conversation_id}")
                return {
                    "success": False,
                    "error": "查询被用户中断",
                    "interrupted": True,
                    "model": model_name or self.config.get("current_model"),
                    "conversation_id": conversation_id
                }
            
            result = interpreter.chat(full_prompt)
            
            # 保存到会话历史
            if conversation_id:
                self._save_to_history(conversation_id, query, result)
            
            # 处理结果
            return {
                "success": True,
                "result": result,
                "model": model_name or self.config.get("current_model"),
                "conversation_id": conversation_id
            }
            
        except KeyboardInterrupt:
            logger.info(f"查询被中断: {conversation_id}")
            return {
                "success": False,
                "error": "查询被中断",
                "interrupted": True,
                "model": model_name or self.config.get("current_model"),
                "conversation_id": conversation_id
            }
        except Exception as e:
            logger.error(f"执行查询失败: {e}")
            return {
                "success": False,
                "error": str(e),
                "model": model_name or self.config.get("current_model"),
                "conversation_id": conversation_id
            }
        finally:
            # 清理session cache
            if conversation_id and conversation_id in self._session_cache:
                with self._session_lock:
                    if conversation_id in self._session_cache:
                        del self._session_cache[conversation_id]
    
    def _build_prompt(self, query: str, context: Dict[str, Any] = None) -> str:
        """构建简洁的提示词，让 OpenInterpreter 自主工作"""
        
        import os
        
        # 如果有数据库连接信息，提供最基础的信息
        if context and context.get('connection_info'):
            conn = context['connection_info']
            
            # 获取项目根目录的绝对路径
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            output_dir = os.path.join(project_root, 'backend', 'output')
            
            # 构建简洁的提示词
            prompt = f"""数据库连接信息（Apache Doris，MySQL协议）：
host = '{conn['host']}'
port = {conn['port']}
user = '{conn['user']}'
password = '{conn['password']}'
database = '{conn.get('database', '')}'  # 初始数据库，可以切换

用户需求：{query}

特别说明：
- 如果用户提到"七折销量"，通常是指：销量 * 0.7（即70%的销量）
- 如果用户要求按月统计，需要GROUP BY月份字段
- 如果要求绘制柱状图，使用plotly.graph_objects或plotly.express

重要要求：
1. 使用 pymysql 连接数据库（不要用 sqlalchemy）

2. **智能探索策略**：
   - 先理解用户需求中的业务语义：
     * "销量"通常指实际销售数量（sale_num/sale_qty/quantity），不是生产计划或预测
     * "七折销量"理解方式：
       - 如果表中有sale_num_discount或类似字段，直接使用
       - 否则计算：销量字段 * 0.7
     * "订单金额"指实际成交金额（knead_pay_amount/pay_amount/order_amount/total_amount）
   - 数据库选择优先级：
     * 优先探索数据仓库：center_dws > dws > dwh > dw（数据仓库更全面）
     * 其次考虑：ods（原始数据）> ads（汇总数据）
   - 表选择策略：
     * 优先选择包含：trd/trade/order/sale + detail/day 的表（交易明细表）
     * 避免：production/forecast/plan/budget（计划类表）
     * 检查表数据量和日期范围，确保包含所需时间段
   - 字段识别：
     * 月份字段：v_month > month > year_month > year_of_month
     * 销量字段：sale_num > sale_qty > quantity > qty
     * 金额字段：pay_amount > order_amount > total_amount
   - 验证数据：查看样例数据确认是否符合需求

3. **数据处理注意事项**：
   - Decimal类型需转换为float进行计算
   - 日期格式统一处理（如 '2025-01' 格式）
   - 数据异常检测（如某月数据异常低，需要说明）
   - **重要**：如果发现负销量或异常值，在SQL中用WHERE条件过滤，不要在Python中过滤
   - **多表选择策略**：
     * 遇到多个候选表时，执行以下检查：
     * 检查数据总量：SELECT COUNT(*) 
     * 检查日期范围：SELECT MIN(日期字段), MAX(日期字段)
     * 查看样例数据：SELECT * LIMIT 5
     * 选择数据最完整、日期范围包含需求时间段的表
   - **探索顺序**：
     * 第一步：SHOW DATABASES 查看所有数据库
     * 第二步：优先进入 center_dws/dws 类数据库
     * 第三步：SHOW TABLES 并用关键词过滤
     * 第四步：对候选表进行数据质量检查

4. 使用 plotly 生成可视化图表
5. 将 HTML 文件保存到：{output_dir}
6. 确保创建输出目录：os.makedirs('{output_dir}', exist_ok=True)
7. **连接管理**：保持连接直到所有操作完成，不要过早关闭

8. **SQL查询示例模板**（按月统计）：
   ```sql
   SELECT 月份字段,
          SUM(销量字段) as total_sales,
          SUM(销量字段) * 0.7 as sales_70pct,  -- 七折销量
          SUM(金额字段) as total_amount
   FROM 数据库.表名
   WHERE 月份字段 LIKE '2025%' 
     AND 销量字段 > 0  -- 过滤异常数据
   GROUP BY 月份字段
   ORDER BY 月份字段
   ```

最后请提供简洁的总结，包括：
- 完成了什么任务
- 生成的文件完整路径
- 数据的关键发现（如有）
"""
            
            # 如果有可用数据库列表，添加参考信息
            if context.get('available_databases'):
                prompt += f"\n可用数据库参考：{', '.join(context['available_databases'])}"
            
            return prompt
        
        # 非数据库查询，直接返回原始查询
        return query
    
    def get_or_create_interpreter(self, conversation_id: Optional[str] = None, 
                                  model_name: Optional[str] = None) -> OpenInterpreter:
        """
        获取或创建interpreter实例
        如果提供conversation_id，尝试重用现有会话
        """
        with self._session_lock:
            # 清理过期会话
            self._cleanup_expired_sessions()
            
            # 如果没有conversation_id，总是创建新实例
            if not conversation_id:
                return self.create_interpreter(model_name)
            
            # 检查是否有缓存的会话
            if conversation_id in self._session_cache:
                # 检查会话是否过期
                last_active = self._session_last_active.get(conversation_id, 0)
                if time.time() - last_active < self.session_timeout:
                    logger.info(f"重用现有会话: {conversation_id}")
                    return self._session_cache[conversation_id]
                else:
                    # 会话过期，移除并创建新的
                    logger.info(f"会话过期，创建新会话: {conversation_id}")
                    del self._session_cache[conversation_id]
                    del self._session_last_active[conversation_id]
            
            # 创建新会话并缓存
            logger.info(f"创建新会话: {conversation_id}")
            interpreter = self.create_interpreter(model_name)
            self._session_cache[conversation_id] = interpreter
            self._session_last_active[conversation_id] = time.time()
            return interpreter
    
    def _cleanup_expired_sessions(self):
        """
        清理过期的会话
        必须在锁内调用
        """
        current_time = time.time()
        expired_sessions = []
        
        for session_id, last_active in self._session_last_active.items():
            if current_time - last_active > self.session_timeout:
                expired_sessions.append(session_id)
        
        for session_id in expired_sessions:
            logger.info(f"清理过期会话: {session_id}")
            if session_id in self._session_cache:
                del self._session_cache[session_id]
            del self._session_last_active[session_id]
    
    def _build_prompt_with_history(self, query: str, context: Dict[str, Any] = None,
                                  conversation_history: Optional[list] = None) -> str:
        """
        构建包含历史上下文的提示词
        """
        # 基础提示词
        base_prompt = self._build_prompt(query, context)
        
        # 如果没有历史记录，直接返回基础提示词
        if not conversation_history:
            return base_prompt
        
        # 构建历史上下文摘要
        history_context = self._summarize_history(conversation_history)
        
        if history_context:
            # 在提示词前添加历史上下文
            enhanced_prompt = f"""## 对话历史上下文
{history_context}

## 当前任务
{base_prompt}"""
            return enhanced_prompt
        
        return base_prompt
    
    def _summarize_history(self, conversation_history: list) -> str:
        """
        总结对话历史，提取关键信息
        只保留最近的3-5轮对话和重要的数据库结构信息
        """
        if not conversation_history:
            return ""
        
        summary_parts = []
        
        # 提取最近的对话（最多3轮）
        recent_messages = conversation_history[-6:]  # 3轮 = 6条消息（用户+助手）
        
        # 查找已探索的数据库和表
        explored_dbs = set()
        explored_tables = set()
        
        for msg in conversation_history:
            content = str(msg.get('content', ''))
            # 查找SHOW DATABASES的结果
            if 'SHOW DATABASES' in content or 'Tables_in_' in content:
                # 提取数据库或表名（简化处理）
                lines = content.split('\n')
                for line in lines:
                    if 'Tables_in_' in line:
                        db_name = line.split('Tables_in_')[1].split()[0] if 'Tables_in_' in line else None
                        if db_name:
                            explored_dbs.add(db_name)
                    # 可以添加更多的模式匹配来提取表名
        
        # 构建摘要
        if explored_dbs:
            summary_parts.append(f"已探索的数据库: {', '.join(explored_dbs)}")
        
        # 添加最近查询的摘要
        if len(recent_messages) > 0:
            summary_parts.append("\n最近的查询历史:")
            for i in range(0, len(recent_messages), 2):
                if i < len(recent_messages) - 1:
                    user_msg = recent_messages[i].get('content', '')[:100]
                    summary_parts.append(f"- 用户: {user_msg}...")
        
        return '\n'.join(summary_parts) if summary_parts else ""
    
    def clear_session(self, conversation_id: str):
        """
        清除特定会话
        """
        with self._session_lock:
            if conversation_id in self._session_cache:
                del self._session_cache[conversation_id]
                logger.info(f"清除会话: {conversation_id}")
            if conversation_id in self._session_last_active:
                del self._session_last_active[conversation_id]
    
    def get_available_models(self) -> list:
        """获取可用的模型列表"""
        return list(self.config.get("models", {}).keys())
    
    def _get_conversation_history(self, conversation_id: str) -> list:
        """获取会话历史"""
        return self._conversation_history.get(conversation_id, [])
    
    def _save_to_history(self, conversation_id: str, query: str, result: Any):
        """保存到会话历史"""
        if conversation_id not in self._conversation_history:
            self._conversation_history[conversation_id] = []
        
        history = self._conversation_history[conversation_id]
        
        # 保存用户查询和AI响应
        history.append({
            "role": "user",
            "content": query,
            "timestamp": time.time()
        })
        
        # 提取关键信息从结果中
        result_summary = self._extract_key_info(result)
        history.append({
            "role": "assistant", 
            "content": result_summary,
            "timestamp": time.time()
        })
        
        # 限制历史长度（保留最近的N轮对话）
        max_messages = self.max_history_rounds * 2  # 每轮包含用户和助手消息
        if len(history) > max_messages:
            # 保留最新的消息
            self._conversation_history[conversation_id] = history[-max_messages:]
            
        logger.info(f"保存会话历史: {conversation_id}, 当前历史长度: {len(self._conversation_history[conversation_id])}")
    
    def _extract_key_info(self, result: Any) -> str:
        """从结果中提取关键信息用于上下文"""
        if not result:
            return ""
        
        # 如果result是列表，提取文本内容
        if isinstance(result, list):
            key_info = []
            for item in result:
                if isinstance(item, dict):
                    content = item.get('content', '')
                    # 提取SQL语句
                    if 'SELECT' in content or 'SHOW' in content:
                        key_info.append(f"执行的SQL: {content[:200]}")
                    # 提取表信息
                    elif 'Tables_in_' in content or 'DESCRIBE' in content:
                        key_info.append(f"探索的表结构: {content[:200]}")
                    # 提取生成的文件
                    elif '.html' in content:
                        import re
                        files = re.findall(r'([^\s]+\.html)', content)
                        if files:
                            key_info.append(f"生成的文件: {', '.join(files)}")
            return '\n'.join(key_info) if key_info else str(result)[:500]
        
        return str(result)[:500]
    
    def _build_prompt_with_context(self, query: str, context: Dict[str, Any] = None, 
                                   conversation_history: list = None) -> str:
        """构建包含历史上下文的提示词"""
        
        # 基础提示词
        base_prompt = self._build_prompt(query, context)
        
        # 如果没有历史，直接返回基础提示词
        if not conversation_history:
            return base_prompt
        
        # 构建历史上下文
        history_text = self._format_history(conversation_history)
        
        if history_text:
            # 在提示词前添加历史上下文
            enhanced_prompt = f"""## 之前的对话上下文
{history_text}

## 当前用户需求
{query}

请基于之前的对话上下文，继续处理当前的需求。如果之前有错误，请尝试修正。

{base_prompt}"""
            return enhanced_prompt
        
        return base_prompt
    
    def _format_history(self, conversation_history: list) -> str:
        """格式化会话历史为文本"""
        if not conversation_history:
            return ""
        
        formatted_parts = []
        for msg in conversation_history[-6:]:  # 只取最近3轮对话
            role = msg.get('role', '')
            content = msg.get('content', '')
            
            if role == 'user':
                formatted_parts.append(f"用户问: {content[:200]}...")
            elif role == 'assistant':
                formatted_parts.append(f"助手答: {content[:300]}...")
        
        return '\n'.join(formatted_parts)
    
    def clear_conversation(self, conversation_id: str):
        """清除特定会话的历史"""
        if conversation_id in self._conversation_history:
            del self._conversation_history[conversation_id]
            logger.info(f"清除会话历史: {conversation_id}")
    
    def stop_query(self, conversation_id: str):
        """尝试停止正在执行的查询"""
        with self._session_lock:
            if conversation_id in self._session_cache:
                interpreter = self._session_cache[conversation_id]
                # OpenInterpreter 0.4.3 没有直接的stop方法
                # 但我们可以通过删除实例来尝试中断
                logger.info(f"尝试停止查询: {conversation_id}")
                try:
                    # 清理interpreter实例
                    del self._session_cache[conversation_id]
                except Exception as e:
                    logger.error(f"停止查询时出错: {e}")