"""
表选择策略模块 - 使用策略模式避免复杂的条件判断
遵循 SOLID 原则
"""
import json
import re
from typing import List, Dict, Optional
from pathlib import Path


class TableClassifier:
    """表分类器 - 单一职责：判断表的业务类型"""
    
    def __init__(self, config_path: str = "table_classification.json"):
        """初始化分类器，加载配置"""
        self.config = self._load_config(config_path)
        self.classifications = self.config.get("table_classification", {})
    
    def _load_config(self, filename: str) -> Dict:
        """加载配置文件 - 避免硬编码"""
        config_file = Path(__file__).parent / filename
        
        if not config_file.exists():
            return self._default_config()
        
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return self._default_config()
    
    def _default_config(self) -> Dict:
        """默认配置 - 容错处理"""
        return {
            "table_classification": {
                "sales": {
                    "patterns": {
                        "must_have": ["sales|invoice"],
                        "must_not_have": ["purchase"]
                    }
                }
            }
        }
    
    def classify(self, table_name: str, sample_fields: List[str] = None) -> str:
        """
        分类表的业务类型
        
        Args:
            table_name: 表名
            sample_fields: 表的字段列表（可选）
        
        Returns:
            表类型：'sales', 'purchase', 或 'unknown'
        """
        table_lower = table_name.lower()
        
        # 按优先级排序分类
        sorted_classifications = sorted(
            self.classifications.items(),
            key=lambda x: x[1].get("priority", 999)
        )
        
        for category, rules in sorted_classifications:
            if self._matches_rules(table_lower, sample_fields, rules):
                return category
        
        return "unknown"
    
    def _matches_rules(self, table_name: str, fields: List[str], rules: Dict) -> bool:
        """检查表名和字段是否匹配规则 - 提取的辅助方法"""
        patterns = rules.get("patterns", {})
        
        # 如果有字段信息，优先使用字段验证
        if fields and rules.get("validation_fields"):
            if self._validate_fields(fields, rules["validation_fields"]):
                return True
        
        # 检查必须包含的模式
        if not self._check_patterns(table_name, patterns.get("must_have", []), True):
            return False
        
        # 检查不能包含的模式
        if not self._check_patterns(table_name, patterns.get("must_not_have", []), False):
            return False
        
        return True
    
    def _check_patterns(self, text: str, patterns: List[str], should_match: bool) -> bool:
        """检查文本是否匹配模式列表 - DRY原则"""
        if not patterns:
            return True
        
        for pattern in patterns:
            if any(re.search(p.strip(), text) for p in pattern.split('|')):
                return should_match
        
        return not should_match
    
    def _validate_fields(self, fields: List[str], validation_fields: List[str]) -> bool:
        """验证字段是否包含期望的业务字段"""
        fields_lower = [f.lower() for f in fields]
        return any(
            vf.lower() in field 
            for vf in validation_fields 
            for field in fields_lower
        )


class FieldMapper:
    """字段映射器 - 单一职责：处理字段名称映射"""
    
    def __init__(self, config: Dict = None):
        """初始化映射器"""
        if config is None:
            config = self._load_default_config()
        self.mappings = config.get("field_mappings", {})
    
    def _load_default_config(self) -> Dict:
        """加载默认配置"""
        config_file = Path(__file__).parent / "table_classification.json"
        
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {"field_mappings": {}}
    
    def get_field_name(self, concept: str, table_type: str = None) -> List[str]:
        """
        获取概念对应的字段名列表
        
        Args:
            concept: 业务概念（如 'quantity', 'amount'）
            table_type: 表类型（如 'sales', 'purchase'）
        
        Returns:
            可能的字段名列表
        """
        if concept not in self.mappings:
            return []
        
        mapping = self.mappings[concept]
        
        # 处理分类型的映射
        if isinstance(mapping, dict) and table_type:
            return mapping.get(table_type, [])
        
        # 处理通用映射
        if isinstance(mapping, list):
            return mapping
        
        return []
    
    def find_field(self, available_fields: List[str], concept: str, 
                   table_type: str = None) -> Optional[str]:
        """
        从可用字段中找到匹配的字段
        
        Args:
            available_fields: 表中的实际字段列表
            concept: 要查找的业务概念
            table_type: 表类型
        
        Returns:
            匹配的字段名，如果没找到返回 None
        """
        candidates = self.get_field_name(concept, table_type)
        
        # 创建小写映射以支持大小写不敏感匹配
        field_map = {f.lower(): f for f in available_fields}
        
        for candidate in candidates:
            if candidate.lower() in field_map:
                return field_map[candidate.lower()]
        
        return None


class SmartTableSelector:
    """智能表选择器 - 组合分类器和映射器"""
    
    def __init__(self):
        """初始化选择器"""
        self.classifier = TableClassifier()
        self.mapper = FieldMapper()
    
    def select_best_table(self, tables: List[str], query: str) -> Optional[str]:
        """根据查询选择最合适的表"""
        if not tables:
            return None
        
        required_type = self._infer_table_type(query.lower())
        classified = self._classify_tables(tables)
        
        # 优先返回所需类型的表
        if required_type and required_type in classified:
            return classified[required_type][0]
        
        # 返回第一个已知类型的表
        return self._get_first_known_table(classified, tables)
    
    def _classify_tables(self, tables: List[str]) -> Dict[str, List[str]]:
        """对表列表进行分类"""
        classified = {}
        for table in tables:
            table_type = self.classifier.classify(table)
            if table_type not in classified:
                classified[table_type] = []
            classified[table_type].append(table)
        return classified
    
    def _get_first_known_table(self, classified: Dict, tables: List[str]) -> Optional[str]:
        """获取第一个已知类型的表"""
        for table_type, table_list in classified.items():
            if table_type != "unknown" and table_list:
                return table_list[0]
        return tables[0] if tables else None
    
    def _infer_table_type(self, query: str) -> Optional[str]:
        """从查询推断需要的表类型 - 简洁的推断逻辑"""
        sales_keywords = ["销售", "销量", "营收", "收入", "发票"]
        purchase_keywords = ["采购", "进货", "供应商"]
        
        if any(kw in query for kw in sales_keywords):
            return "sales"
        if any(kw in query for kw in purchase_keywords):
            return "purchase"
        
        return None
    
    def get_query_fields(self, query: str, table_type: str) -> Dict[str, List[str]]:
        """
        根据查询获取需要的字段
        
        Args:
            query: 用户查询
            table_type: 表类型
        
        Returns:
            概念到字段名的映射
        """
        result = {}
        
        # 检查常见概念
        concepts = ["quantity", "amount", "department", "date"]
        
        for concept in concepts:
            fields = self.mapper.get_field_name(concept, table_type)
            if fields:
                result[concept] = fields
        
        return result