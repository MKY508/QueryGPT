"""历史记录API蓝图"""
import logging
from flask import Blueprint, request, jsonify, session, g

from backend.core import service_container
from backend.utils import parse_date_param, conversation_in_range

logger = logging.getLogger(__name__)

history_bp = Blueprint('history', __name__, url_prefix='/api/history')
services = service_container


def _get_history_manager():
    """从 Flask 上下文获取历史记录管理器（优先），否则回退到全局服务容器"""
    if hasattr(g, 'history_manager'):
        return g.history_manager
    return services.history_manager


def ensure_history_manager(force_reload: bool = False) -> bool:
    """确保 history_manager 已初始化（优化版本）"""
    if _get_history_manager() is not None:
        return True
    return services.ensure_history_manager(force_reload=force_reload)


@history_bp.route('/conversations', methods=['GET'])
def get_conversations():
    """获取对话历史列表"""
    try:
        if not ensure_history_manager():
            return jsonify({"success": False, "conversations": [], "error": "历史记录未启用"}), 503

        history_manager = _get_history_manager()
        query = request.args.get('q', '')
        limit = int(request.args.get('limit', 50))
        favorites_only = request.args.get('favorites', 'false').lower() == 'true'
        start_date = parse_date_param(request.args.get('start_date'))
        end_date = parse_date_param(request.args.get('end_date'))
        
        if favorites_only:
            conversations = history_manager.get_favorite_conversations()
            if start_date or end_date:
                conversations = [
                    item for item in conversations
                    if conversation_in_range(item, start_date, end_date)
                ]
        elif query or start_date or end_date:
            conversations = history_manager.search_conversations(
                query=query,
                start_date=start_date,
                end_date=end_date,
                limit=limit
            )
        else:
            conversations = history_manager.get_recent_conversations(limit=limit)
        
        return jsonify({
            "success": True,
            "conversations": conversations
        })
    except Exception as e:
        logger.error(f"获取对话历史失败: {e}")
        return jsonify({"error": str(e)}), 500


@history_bp.route('/conversation/<conversation_id>', methods=['GET'])
def get_conversation_detail(conversation_id):
    """获取单个对话的详细信息"""
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        history_manager = _get_history_manager()
        conversation = history_manager.get_conversation_history(conversation_id)
        if not conversation:
            return jsonify({"error": "对话不存在"}), 404
        
        return jsonify({
            "success": True,
            "conversation": conversation
        })
    except Exception as e:
        logger.error(f"获取对话详情失败: {e}")
        return jsonify({"error": str(e)}), 500


@history_bp.route('/<conversation_id>', methods=['GET'])
def get_conversation_detail_compat(conversation_id):
    """兼容端点：/api/history/<conversation_id>"""
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        history_manager = _get_history_manager()
        conv = history_manager.get_conversation_history(conversation_id)
        if not conv:
            return jsonify({"error": "对话不存在"}), 404
        
        # 兼容测试返回结构：顶层提供 messages
        messages = conv.get('messages') if isinstance(conv, dict) else None
        if messages is None and isinstance(conv, list):
            messages = conv
        return jsonify({
            "messages": messages or []
        })
    except Exception as e:
        logger.error(f"获取对话详情失败: {e}")
        return jsonify({"error": str(e)}), 500


@history_bp.route('/conversation/<conversation_id>/favorite', methods=['POST'])
def toggle_favorite_conversation(conversation_id):
    """切换收藏状态"""
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        history_manager = _get_history_manager()
        is_favorite = history_manager.toggle_favorite(conversation_id)
        return jsonify({
            "success": True,
            "is_favorite": is_favorite
        })
    except Exception as e:
        logger.error(f"切换收藏状态失败: {e}")
        return jsonify({"error": str(e)}), 500


@history_bp.route('/conversation/<conversation_id>', methods=['DELETE'])
def delete_conversation_api(conversation_id):
    """删除对话"""
    try:
        if not ensure_history_manager():
            return jsonify({"success": False, "error": "历史记录未启用"}), 503

        history_manager = _get_history_manager()
        
        # 验证对话是否存在
        conversation = history_manager.get_conversation_history(conversation_id)
        if not conversation:
            logger.warning(f"尝试删除不存在的对话: {conversation_id}")
            return jsonify({
                "success": False,
                "error": "对话不存在"
            }), 404
        
        # 执行删除
        deleted = history_manager.delete_conversation(conversation_id)
        
        if not deleted:
            logger.warning(f"删除对话失败，可能已被删除: {conversation_id}")
            return jsonify({
                "success": False,
                "error": "删除失败，对话可能已被删除"
            }), 400
        
        # 清理当前会话ID（如果删除的是当前对话）
        if session.get('current_conversation_id') == conversation_id:
            session.pop('current_conversation_id', None)
            logger.info(f"清理了当前会话ID: {conversation_id}")
        
        logger.info(f"成功删除对话: {conversation_id}")
        return jsonify({
            "success": True,
            "message": "对话已删除"
        })
    except Exception as e:
        logger.error(f"删除对话失败 {conversation_id}: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@history_bp.route('/statistics', methods=['GET'])
def get_history_statistics():
    """获取历史统计信息"""
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        history_manager = _get_history_manager()
        stats = history_manager.get_statistics()
        return jsonify({
            "success": True,
            "statistics": stats
        })
    except Exception as e:
        logger.error(f"获取统计信息失败: {e}")
        return jsonify({"error": str(e)}), 500


@history_bp.route('/cleanup', methods=['POST'])
def cleanup_history():
    """清理旧历史记录"""
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        history_manager = _get_history_manager()
        data = request.json or {}
        days = data.get('days', 90)
        history_manager.cleanup_old_conversations(days)
        return jsonify({
            "success": True,
            "message": f"已清理{days}天前的历史记录"
        })
    except Exception as e:
        logger.error(f"清理历史记录失败: {e}")
        return jsonify({"error": str(e)}), 500


@history_bp.route('/replay/<conversation_id>', methods=['POST'])
def replay_conversation(conversation_id):
    """复现对话"""
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        history_manager = _get_history_manager()
        conversation = history_manager.get_conversation_history(conversation_id)
        if not conversation:
            return jsonify({"error": "对话不存在"}), 404
        
        # 恢复会话状态（如果有）
        session_state = conversation.get('session_state')
        if session_state:
            logger.info(f"恢复会话状态: {conversation_id}")
        
        return jsonify({
            "success": True,
            "conversation": conversation,
            "message": "对话已加载，可以继续交互"
        })
    except Exception as e:
        logger.error(f"复现对话失败: {e}")
        return jsonify({"error": str(e)}), 500


# 兼容端点将在app.py中注册

