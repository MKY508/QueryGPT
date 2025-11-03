"""Prompt设置API蓝图"""
import os
import json
import logging
from flask import Blueprint, request, jsonify

from backend.core import service_container

logger = logging.getLogger(__name__)

prompt_bp = Blueprint('prompt', __name__, url_prefix='/api')
services = service_container


def _get_default_prompts():
    """获取默认Prompt配置"""
    return {
        "systemMessage": {
            "DIRECT_SQL": {
                "zh": "你是一个SQL查询专家。你的任务是：\n1. 连接数据库并执行SQL查询\n2. 以清晰的表格格式返回查询结果\n3. 提供查询统计信息（如记录数、执行时间）\n4. 【重要】不要创建任何可视化图表\n5. 【重要】不要保存文件到output目录\n6. 只专注于数据检索和展示\n\n数据库已配置，直接使用pymysql执行查询即可。",
                "en": "You are a SQL query expert. Your tasks are:\n1. Connect to database and execute SQL queries\n2. Return results in clear tabular format\n3. Provide query statistics (record count, execution time)\n4. [IMPORTANT] DO NOT create any visualizations or charts\n5. [IMPORTANT] DO NOT save files to output directory\n6. Focus only on data retrieval and display\n\nDatabase is configured, use pymysql directly to execute queries."
            },
            "AI_ANALYSIS": {
                "zh": "你是一个数据分析专家。你可以：\n1. 执行复杂的数据查询和分析\n2. 使用pandas进行数据处理和转换\n3. 使用plotly创建交互式图表和可视化\n4. 保存分析结果和图表到output目录\n5. 进行趋势分析、预测和深度洞察\n6. 生成美观的数据仪表板\n\n充分发挥你的分析能力，为用户提供有价值的数据洞察。",
                "en": "You are a data analysis expert. You can:\n1. Execute complex data queries and analysis\n2. Use pandas for data processing and transformation\n3. Use plotly to create interactive charts and visualizations\n4. Save analysis results and charts to output directory\n5. Perform trend analysis, predictions and deep insights\n6. Generate beautiful data dashboards\n\nLeverage your analytical capabilities to provide valuable data insights."
            }
        },
        "routing": "你是一个查询路由分类器。分析用户查询，选择最适合的执行路径。\n\n用户查询：{query}\n\n数据库信息：\n- 类型：{db_type}\n- 可用表：{available_tables}\n\n请从以下2个选项中选择最合适的路由：\n\n1. DIRECT_SQL - 简单查询，可以直接转换为SQL执行\n   适用：查看数据、统计数量、简单筛选、排序、基础聚合\n   示例：显示所有订单、统计用户数量、查看最新记录、按月统计销售额、查找TOP N\n   特征：不需要复杂计算、不需要图表、不需要多步处理\n\n2. AI_ANALYSIS - 需要AI智能处理的查询\n   适用：数据分析、生成图表、趋势预测、复杂计算、多步处理\n   示例：分析销售趋势、生成可视化图表、预测分析、原因探索\n   特征：需要可视化、需要推理、需要编程逻辑、复杂数据处理\n\n输出格式（JSON）：\n{\n  \"route\": \"DIRECT_SQL 或 AI_ANALYSIS\",\n  \"confidence\": 0.95,\n  \"reason\": \"选择此路由的原因\",\n  \"suggested_sql\": \"如果是DIRECT_SQL，提供建议的SQL语句\"\n}\n\n判断规则：\n- 如果查询包含\"图\"、\"图表\"、\"可视化\"、\"绘制\"、\"plot\"、\"chart\"等词 → 选择 AI_ANALYSIS\n- 如果查询包含\"分析\"、\"趋势\"、\"预测\"、\"为什么\"、\"原因\"等词 → 选择 AI_ANALYSIS\n- 如果只是简单的数据查询、统计、筛选 → 选择 DIRECT_SQL\n- 当不确定时，倾向选择 AI_ANALYSIS 以确保功能完整",
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
        'directSql': '',
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
    
    if 'systemMessage' in config:
        if 'DIRECT_SQL' in config['systemMessage']:
            flat['directSql'] = config['systemMessage']['DIRECT_SQL'].get('zh', '')
        if 'AI_ANALYSIS' in config['systemMessage']:
            flat['aiAnalysis'] = config['systemMessage']['AI_ANALYSIS'].get('zh', '')
    
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
                'DIRECT_SQL': {'zh': '', 'en': ''},
                'AI_ANALYSIS': {'zh': '', 'en': ''}
            }
        
        # 映射前端字段到后端结构
        if 'directSql' in data:
            if 'DIRECT_SQL' not in new_config['systemMessage']:
                new_config['systemMessage']['DIRECT_SQL'] = {}
            new_config['systemMessage']['DIRECT_SQL']['zh'] = data['directSql']
            if 'en' not in new_config['systemMessage']['DIRECT_SQL']:
                new_config['systemMessage']['DIRECT_SQL']['en'] = ''
        
        if 'aiAnalysis' in data:
            if 'AI_ANALYSIS' not in new_config['systemMessage']:
                new_config['systemMessage']['AI_ANALYSIS'] = {}
            new_config['systemMessage']['AI_ANALYSIS']['zh'] = data['aiAnalysis']
            if 'en' not in new_config['systemMessage']['AI_ANALYSIS']:
                new_config['systemMessage']['AI_ANALYSIS']['en'] = ''
        
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
        smart_router = services.smart_router
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
        smart_router = services.smart_router
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
        return jsonify({"success": True, "message": "已恢复默认Prompt设置", "prompts": flat})
    except Exception as e:
        logger.error(f"恢复默认Prompt设置失败: {e}")
        return jsonify({"error": str(e)}), 500

