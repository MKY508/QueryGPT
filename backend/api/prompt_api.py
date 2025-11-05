"""Prompt设置API蓝图"""
import os
import json
import logging
from flask import Blueprint, request, jsonify, g

from backend.core import service_container

logger = logging.getLogger(__name__)

prompt_bp = Blueprint('prompt', __name__, url_prefix='/api')
services = service_container


def _get_smart_router():
    """从 Flask 上下文获取智能路由器（优先），否则回退到全局服务容器"""
    if hasattr(g, 'smart_router'):
        return g.smart_router
    return services.smart_router


def _get_default_prompts():
    """获取默认Prompt配置"""
    return {
        "systemMessage": {
            "QA": {
                "zh": "你是一个数据库助手。当用户提问与数据库或分析无关时，请礼貌拒绝：\n- 说明自己专注于数据库取数与分析\n- 引导用户描述需要查询的表、指标或时间范围\n- 不编造答案，只提供诚恳建议",
                "en": "You are a database assistant. When the query is unrelated to databases or analytics:\n- Politely explain you focus on database retrieval and analysis\n- Guide the user to describe the required tables, metrics, or time range\n- Avoid fabricating answers; offer constructive suggestions"
            },
            "ANALYSIS": {
                "zh": "你是 QueryGPT 的数据分析助手，负责从只读数据库中探索、取数并生成业务洞察。请遵循以下流程：\n\n【阶段 1：建立连接】\n- 使用提供的 pymysql 参数建立连接（失败时说明 host:port 与报错并结束）。\n- 连接成功后执行 SELECT VERSION() 获取数据库方言。\n\n【阶段 2：数据库探索策略（未指定 database 时）】\n1. cursor.execute(\"SHOW DATABASES\")\n2. 根据业务关键词与优先级筛选库：销售相关优先匹配 sales/trade/order/trd；仓库优先级 center_dws > dws > dwh > dw > ods > ads\n3. cursor.execute(f\"USE `{target_db}`\")\n4. cursor.execute(\"SHOW TABLES\")\n5. 对候选表执行 DESCRIBE 与 SELECT * LIMIT 10 验证结构与样本\n\n【阶段 3：表选择与字段策略】\n- 优先选择包含 trd/trade/order/sale + detail/day 的表；避免 production/forecast/plan/budget\n- 字段识别：月份 v_month > month > year_month > year_of_month；销量 sale_num > sale_qty > quantity > qty；金额 pay_amount > order_amount > total_amount\n\n【阶段 4：数据处理与分析】\n- Decimal 转 float，统一日期格式，必要时在 SQL 中过滤异常值\n- 编写只读 SQL，使用 pandas 处理；需要可视化时用 plotly 保存到 output/ 目录\n- 操作前可用 print(f\"[步骤 {index}] {summary}\") 说明动作，真实发现请用普通文本描述\n- 严禁访问本地 CSV/Excel/SQLite 文件，除非用户明确授权\n\n【阶段 5：输出要求与沟通】\n- 说明完成的操作、关键发现、局限与下一步建议\n- 若遇阻断（连接失败、无匹配数据等），说明具体原因并提供排查建议\n- 仅在多次探索仍缺少信息时，礼貌向用户询问补充细节。",
                "en": "You are the QueryGPT data analysis assistant responsible for exploring read-only databases and producing insights. Follow this workflow:\n\n[Stage 1: Establish the connection]\n- Use the provided pymysql credentials (if it fails, report host:port and the error, then stop).\n- After connecting, run SELECT VERSION() to learn the dialect.\n\n[Stage 2: Database exploration strategy (when database is not specified)]\n1. cursor.execute(\"SHOW DATABASES\")\n2. Select candidates using business keywords (sales/trade/order/trd) and priority order center_dws > dws > dwh > dw > ods > ads\n3. cursor.execute(f\"USE `{target_db}`\")\n4. cursor.execute(\"SHOW TABLES\")\n5. Run DESCRIBE and SELECT * LIMIT 10 on candidates to verify structure and sample data\n\n[Stage 3: Table and field strategy]\n- Prefer tables containing trd/trade/order/sale plus detail/day; avoid production/forecast/plan/budget tables\n- Field heuristics: month v_month > month > year_month > year_of_month; volume sale_num > sale_qty > quantity > qty; amount pay_amount > order_amount > total_amount\n\n[Stage 4: Processing and analysis]\n- Cast Decimal to float, normalize date formats, filter anomalies in SQL when needed\n- Write read-only SQL, process with pandas, and save visualisations with plotly to the output/ directory\n- You may print(f\"[Step {index}] {summary}\") before each action; present findings in regular prose\n- Never access local CSV/Excel/SQLite files unless explicitly provided\n\n[Stage 5: Reporting]\n- State completed actions, key findings, limitations, and next steps\n- If blocked (connection failure, no matching data, missing permissions), explain the precise reason and offer actionable troubleshooting guidance\n- Ask the user for additional details only after exhausting the exploration strategy."
            }
        },
        "routing": "你是一个查询路由分类器。分析用户查询，选择最适合的执行路径，并仅输出规范 JSON。\n\n用户查询：{query}\n\n数据库信息：\n- 类型：{db_type}\n- 可用表：{available_tables}\n\n请从以下路由中选择其一：\n\n1. QA\n   - 适用：闲聊、与数据库无关的问题\n   - 输出：礼貌拒绝或引导用户提供数据库需求\n   - 不执行 SQL 或代码\n\n2. ANALYSIS\n   - 适用：所有与数据库相关的取数或数据分析任务（无论简单或复杂）\n   - 允许：执行 Python、生成图表，必要时经用户确认安装库\n\n如判断输入与数据库无关，应选择 QA。\n如请求涉及数据库或数据分析，即使只需简单 SQL，也选择 ANALYSIS，并在 reason 中说明判断依据。\n\n输出 JSON（仅此内容）：\n{\n  \"route\": \"QA | ANALYSIS\",\n  \"confidence\": 0.0-1.0,\n  \"reason\": \"简要说明判断依据\",\n  \"suggested_plan\": [\"步骤1\", \"步骤2\"]\n}\n\n若无法判定，请将 route 设置为 \"ANALYSIS\" 并说明原因。",
        "exploration": "数据库探索策略（当未指定database时）：\n1. 先执行 SHOW DATABASES 查看所有可用数据库\n2. 根据用户需求选择合适的数据库：\n   * 销售相关：包含 sales/trade/order/trd 关键词的库\n   * 数据仓库优先：center_dws > dws > dwh > dw > ods > ads\n3. USE 选中的数据库后，SHOW TABLES 查看表列表\n4. 对候选表执行 DESCRIBE 了解字段结构\n5. 查询样本数据验证内容，根据需要调整查询范围\n\n注意：智能选择相关数据库和表，避免无关数据的查询",
        "tableSelection": "表选择策略：\n1. 优先选择包含业务关键词的表：trd/trade/order/sale + detail/day\n2. 避免计划类表：production/forecast/plan/budget\n3. 检查表数据：\n   * 先 SELECT COUNT(*) 确认有数据\n   * 再 SELECT MIN(date_field), MAX(date_field) 确认时间范围\n   * 查看样本数据了解结构",
        "fieldMapping": "字段映射规则：\n* 日期字段：date > order_date > trade_date > create_time > v_month\n* 销量字段：sale_num > sale_qty > quantity > qty > amount\n* 金额字段：pay_amount > order_amount > total_amount > price\n* 折扣字段：discount > discount_rate > discount_amount",
        "dataProcessing": "数据处理要求：\n1. 使用 pymysql 创建数据库连接\n2. Decimal类型转换为float进行计算\n3. 日期格式统一处理（如 '2025-01' 格式）\n4. 过滤异常数据：WHERE amount > 0 AND date IS NOT NULL\n5. 限制查询结果：大表查询加 LIMIT 10000",
        "outputRequirements": "输出要求：\n1. 必须从MySQL数据库查询，禁止查找CSV文件\n2. 探索数据库时有节制，避免全表扫描\n3. 使用 plotly 生成交互式图表\n4. 将图表保存为 HTML 到 output 目录\n5. 提供查询过程总结和关键发现"
    }


def _flatten_prompts(config):
    """将嵌套的Prompt配置扁平化为前端格式"""
    flat = {
        'routing': config.get('routing', ''),
        'qaPrompt': '',
        'analysisPrompt': '',
        # 兼容旧字段
        'aiAnalysis': '',
        'exploration': config.get('exploration', ''),
        'tableSelection': config.get('tableSelection', ''),
        'fieldMapping': config.get('fieldMapping', ''),
        'dataProcessing': config.get('dataProcessing', ''),
        'outputRequirements': config.get('outputRequirements', ''),
        'summarization': config.get('summarization', ''),
        'errorHandling': config.get('errorHandling', ''),
        'visualization': config.get('visualization', ''),
        'dataAnalysis': config.get('dataAnalysis', ''),
        'sqlGeneration': config.get('sqlGeneration', ''),
        'codeReview': config.get('codeReview', ''),
        'progressPlanner': config.get('progressPlanner', '')
    }
    
    system_messages = config.get('systemMessage', {})
    if 'QA' in system_messages:
        flat['qaPrompt'] = system_messages['QA'].get('zh', '')
    if 'ANALYSIS' in system_messages:
        flat['analysisPrompt'] = system_messages['ANALYSIS'].get('zh', '')
        flat['aiAnalysis'] = flat['analysisPrompt']
    
    return flat


@prompt_bp.route('/prompts', methods=['GET'])
def get_prompts():
    """获取当前的Prompt设置"""
    try:
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'prompt_config.json')
        
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                prompts = json.load(f)
                return jsonify(_flatten_prompts(prompts))
        else:
            # 返回默认设置
            default_prompts = _get_default_prompts()
            flat = _flatten_prompts(default_prompts)
            # 添加高级Prompt默认值
            flat.update({
                'summarization': '基于分析结果，用2–4句中文业务语言总结关键发现、趋势或异常，避免技术细节。',
                'errorHandling': '当出现错误时，先识别错误类型（连接/权限/语法/超时），用中文简洁解释并给出下一步建议，避免输出堆栈与敏感信息。',
                'visualization': '根据数据特征选择合适的可视化类型（柱/线/饼/散点等），使用中文标题与轴标签，保存为HTML至output目录。',
                'dataAnalysis': '进行数据清洗、聚合、对比、趋势与异常分析，确保结果可解释与复现，必要时输出方法与局限说明（中文）。',
                'sqlGeneration': '从自然语言与schema生成只读SQL，遵循只读限制（SELECT/SHOW/DESCRIBE/EXPLAIN），避免危险语句与全表扫描。',
                'codeReview': '对将要执行的代码进行安全与必要性检查，避免长时/不必要操作，给出简洁优化建议（中文）。',
                'progressPlanner': '将当前执行阶段总结为不超过10字的中文短语，面向非技术用户，如"连接数据库""查询数据""生成图表"。'
            })
            return jsonify(flat)
    except Exception as e:
        logger.error(f"获取Prompt设置失败: {e}")
        return jsonify({"error": str(e)}), 500


@prompt_bp.route('/prompts', methods=['POST'])
def save_prompts():
    """保存Prompt设置"""
    try:
        data = request.json
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'prompt_config.json')
        
        # 读取现有配置
        existing_config = {}
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                existing_config = json.load(f)
        
        new_config = existing_config.copy()
        
        # 确保有systemMessage结构
        if 'systemMessage' not in new_config:
            new_config['systemMessage'] = {
                'QA': {'zh': '', 'en': ''},
                'ANALYSIS': {'zh': '', 'en': ''}
            }
        
        # 映射前端字段到后端结构（兼容旧字段）
        if 'qaPrompt' in data:
            new_config['systemMessage'].setdefault('QA', {})['zh'] = data['qaPrompt']
            new_config['systemMessage']['QA'].setdefault('en', '')
        if 'analysisPrompt' in data:
            new_config['systemMessage'].setdefault('ANALYSIS', {})['zh'] = data['analysisPrompt']
            new_config['systemMessage']['ANALYSIS'].setdefault('en', '')
        # 兼容旧字段
        if 'aiAnalysis' in data and not data.get('analysisPrompt'):
            new_config['systemMessage'].setdefault('ANALYSIS', {})['zh'] = data['aiAnalysis']
            new_config['systemMessage']['ANALYSIS'].setdefault('en', '')
        
        # 保持其他字段
        for key in [
            'routing', 'exploration', 'tableSelection', 'fieldMapping', 
            'dataProcessing', 'outputRequirements', 'summarization', 
            'errorHandling', 'visualization', 'dataAnalysis', 
            'sqlGeneration', 'codeReview', 'progressPlanner'
        ]:
            if key in data:
                new_config[key] = data[key]
        
        # 保存到文件
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(new_config, f, ensure_ascii=False, indent=2)
        
        # 更新智能路由器的prompt
        smart_router = _get_smart_router()
        if 'routing' in new_config and smart_router:
            smart_router.update_routing_prompt(new_config['routing'])
            logger.info("智能路由Prompt已更新")
        
        flat = _flatten_prompts(new_config)
        logger.info("Prompt设置已保存")
        return jsonify({"success": True, "message": "Prompt设置已保存", "prompts": flat})
    except Exception as e:
        logger.error(f"保存Prompt设置失败: {e}")
        return jsonify({"error": str(e)}), 500


@prompt_bp.route('/prompts/reset', methods=['POST'])
def reset_prompts():
    """恢复默认Prompt设置"""
    try:
        default_prompts = _get_default_prompts()
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'prompt_config.json')
        
        # 保存默认设置到文件
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(default_prompts, f, ensure_ascii=False, indent=2)
        
        # 更新智能路由器的prompt
        smart_router = _get_smart_router()
        if smart_router and 'routing' in default_prompts:
            smart_router.update_routing_prompt(default_prompts['routing'])
            logger.info("智能路由Prompt已恢复默认")
        
        flat = _flatten_prompts(default_prompts)
        # 添加高级Prompt默认值
        flat.update({
            'summarization': '基于分析结果，用2–4句中文业务语言总结关键发现、趋势或异常，避免技术细节。',
            'errorHandling': '当出现错误时，先识别错误类型（连接/权限/语法/超时），用中文简洁解释并给出下一步建议，避免输出堆栈与敏感信息。',
            'visualization': '根据数据特征选择合适的可视化类型（柱/线/饼/散点等），使用中文标题与轴标签，保存为HTML至output目录。',
            'dataAnalysis': '进行数据清洗、聚合、对比、趋势与异常分析，确保结果可解释与复现，必要时输出方法与局限说明（中文）。',
            'sqlGeneration': '从自然语言与schema生成只读SQL，遵循只读限制（SELECT/SHOW/DESCRIBE/EXPLAIN），避免危险语句与全表扫描。',
            'codeReview': '对将要执行的代码进行安全与必要性检查，避免长时/不必要操作，给出简洁优化建议（中文）。',
            'progressPlanner': '将当前执行阶段总结为不超过10字的中文短语，面向非技术用户，如"连接数据库""查询数据""生成图表"。'
        })
        logger.info("已恢复默认Prompt设置")
        return jsonify({"success": True, "message": "Prompt设置已恢复默认", "prompts": flat})
    except Exception as e:
        logger.error(f"恢复默认Prompt设置失败: {e}")
        return jsonify({"error": str(e)}), 500

