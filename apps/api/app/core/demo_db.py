"""示例数据库初始化模块

创建一个包含销售、产品、客户等数据的 SQLite 示例数据库，
用于演示 QueryGPT 的查询和可视化功能。
"""

import random
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import structlog

logger = structlog.get_logger()

# 示例数据库路径
DEMO_DB_PATH = Path(__file__).parent.parent.parent / "data" / "demo.db"

# 产品数据
PRODUCTS = [
    ("iPhone 15 Pro", "手机", 7999, 5500),
    ("iPhone 15", "手机", 5999, 4200),
    ("MacBook Pro 14", "电脑", 14999, 10500),
    ("MacBook Air", "电脑", 8999, 6300),
    ("iPad Pro", "平板", 6499, 4500),
    ("iPad Air", "平板", 4399, 3100),
    ("AirPods Pro", "配件", 1899, 1200),
    ("Apple Watch", "穿戴", 2999, 2100),
    ("Magic Keyboard", "配件", 999, 650),
    ("Studio Display", "显示器", 11499, 8000),
    ("Mac Mini", "电脑", 4499, 3100),
    ("HomePod", "智能家居", 2299, 1600),
]

# 地区数据
REGIONS = ["华东", "华南", "华北", "西南", "华中"]

# 客户姓名（示例）
FIRST_NAMES = ["张", "李", "王", "刘", "陈", "杨", "黄", "赵", "周", "吴"]
LAST_NAMES = [
    "伟",
    "芳",
    "娜",
    "敏",
    "静",
    "丽",
    "强",
    "磊",
    "军",
    "洋",
    "勇",
    "艳",
    "杰",
    "涛",
    "明",
]

# 订单状态
ORDER_STATUSES = ["已完成", "已发货", "处理中", "已取消"]


def get_demo_db_path() -> str:
    """获取示例数据库的绝对路径"""
    return str(DEMO_DB_PATH.absolute())


def init_demo_database() -> str:
    """初始化示例数据库，返回数据库路径"""
    # 确保目录存在
    DEMO_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    # 如果数据库已存在，直接返回
    if DEMO_DB_PATH.exists():
        logger.info("Demo database already exists", path=str(DEMO_DB_PATH))
        return str(DEMO_DB_PATH)

    logger.info("Creating demo database", path=str(DEMO_DB_PATH))

    conn = sqlite3.connect(DEMO_DB_PATH)
    cursor = conn.cursor()

    try:
        # 创建表
        _create_tables(cursor)

        # 插入产品数据
        _insert_products(cursor)

        # 插入客户数据
        _insert_customers(cursor)

        # 插入销售数据（12个月）
        _insert_sales(cursor)

        # 插入订单数据
        _insert_orders(cursor)

        conn.commit()
        logger.info(
            "Demo database created successfully",
            products=len(PRODUCTS),
            customers=100,
            path=str(DEMO_DB_PATH),
        )

    except Exception as e:
        conn.rollback()
        logger.error("Failed to create demo database", error=str(e))
        raise
    finally:
        conn.close()

    return str(DEMO_DB_PATH)


def _create_tables(cursor: sqlite3.Cursor) -> None:
    """创建数据表"""

    # 产品表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            price REAL NOT NULL,
            cost REAL NOT NULL,
            created_at DATE DEFAULT CURRENT_DATE
        )
    """)

    # 客户表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            region TEXT NOT NULL,
            email TEXT,
            registered_at DATE NOT NULL
        )
    """)

    # 销售表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date DATE NOT NULL,
            product_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL,
            amount REAL NOT NULL,
            region TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (customer_id) REFERENCES customers(id)
        )
    """)

    # 订单表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_no TEXT NOT NULL UNIQUE,
            order_date DATE NOT NULL,
            customer_id INTEGER NOT NULL,
            total_amount REAL NOT NULL,
            status TEXT NOT NULL,
            FOREIGN KEY (customer_id) REFERENCES customers(id)
        )
    """)

    # 创建索引
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sales_region ON sales(region)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date)")


def _insert_products(cursor: sqlite3.Cursor) -> None:
    """插入产品数据"""
    cursor.executemany(
        "INSERT INTO products (name, category, price, cost) VALUES (?, ?, ?, ?)", PRODUCTS
    )


def _insert_customers(cursor: sqlite3.Cursor) -> None:
    """插入客户数据"""
    customers = []
    base_date = datetime.now() - timedelta(days=365)

    for i in range(100):
        name = random.choice(FIRST_NAMES) + random.choice(LAST_NAMES)
        region = random.choice(REGIONS)
        email = f"user{i + 1}@example.com"
        # 随机注册日期（过去一年内）
        registered_at = base_date + timedelta(days=random.randint(0, 365))
        customers.append((name, region, email, registered_at.strftime("%Y-%m-%d")))

    cursor.executemany(
        "INSERT INTO customers (name, region, email, registered_at) VALUES (?, ?, ?, ?)", customers
    )


def _insert_sales(cursor: sqlite3.Cursor) -> None:
    """插入销售数据（过去12个月，带有趋势和季节性）"""
    sales = []
    today = datetime.now()

    # 生成过去12个月的数据
    for month_offset in range(12, 0, -1):
        # 计算月份
        month_date = today - timedelta(days=month_offset * 30)
        days_in_month = 30

        # 季节性因子（Q4 销售旺季）
        month = month_date.month
        if month in [11, 12, 1]:  # 旺季
            seasonal_factor = 1.5
        elif month in [6, 7, 8]:  # 淡季
            seasonal_factor = 0.8
        else:
            seasonal_factor = 1.0

        # 增长趋势（每月增长 3%）
        growth_factor = 1 + (12 - month_offset) * 0.03

        # 每月生成 40-80 条销售记录
        num_sales = int(random.randint(40, 80) * seasonal_factor * growth_factor)

        for _ in range(num_sales):
            # 随机日期
            day = random.randint(1, days_in_month)
            sale_date = month_date.replace(day=min(day, 28))

            # 随机产品和客户
            product_id = random.randint(1, len(PRODUCTS))
            customer_id = random.randint(1, 100)

            # 获取产品价格
            product = PRODUCTS[product_id - 1]
            unit_price = product[2]

            # 随机数量（1-5）
            quantity = random.randint(1, 5)
            amount = unit_price * quantity

            # 随机地区
            region = random.choice(REGIONS)

            sales.append(
                (
                    sale_date.strftime("%Y-%m-%d"),
                    product_id,
                    customer_id,
                    quantity,
                    unit_price,
                    amount,
                    region,
                )
            )

    cursor.executemany(
        """INSERT INTO sales (date, product_id, customer_id, quantity, unit_price, amount, region)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        sales,
    )


def _insert_orders(cursor: sqlite3.Cursor) -> None:
    """插入订单数据"""
    orders = []
    today = datetime.now()

    for i in range(200):
        # 随机日期（过去6个月）
        order_date = today - timedelta(days=random.randint(0, 180))
        order_no = f"ORD{order_date.strftime('%Y%m%d')}{i + 1:04d}"
        customer_id = random.randint(1, 100)
        total_amount = random.uniform(1000, 50000)

        # 状态分布：70% 已完成，15% 已发货，10% 处理中，5% 已取消
        status_rand = random.random()
        if status_rand < 0.70:
            status = "已完成"
        elif status_rand < 0.85:
            status = "已发货"
        elif status_rand < 0.95:
            status = "处理中"
        else:
            status = "已取消"

        orders.append(
            (order_no, order_date.strftime("%Y-%m-%d"), customer_id, round(total_amount, 2), status)
        )

    cursor.executemany(
        """INSERT INTO orders (order_no, order_date, customer_id, total_amount, status)
           VALUES (?, ?, ?, ?, ?)""",
        orders,
    )


def reset_demo_database() -> str:
    """重置示例数据库（删除后重新创建）"""
    if DEMO_DB_PATH.exists():
        DEMO_DB_PATH.unlink()
        logger.info("Demo database deleted", path=str(DEMO_DB_PATH))

    return init_demo_database()
