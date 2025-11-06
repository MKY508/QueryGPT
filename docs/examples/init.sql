-- QueryGPT 示例数据库初始化脚本
-- 用于 Docker MySQL 容器的初始数据

-- 确保使用 UTF-8 编码支持中文
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
SET character_set_connection=utf8mb4;

-- 创建示例数据库（如果不存在）
CREATE DATABASE IF NOT EXISTS test_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE test_db;

-- 创建产品表
CREATE TABLE IF NOT EXISTS `产品` (
    `产品ID` INT PRIMARY KEY AUTO_INCREMENT,
    `产品名称` VARCHAR(100) NOT NULL,
    `类别` VARCHAR(50),
    `单价` DECIMAL(10, 2),
    `库存量` INT DEFAULT 0,
    `创建时间` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_category (`类别`),
    INDEX idx_name (`产品名称`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建客户表
CREATE TABLE IF NOT EXISTS `客户` (
    `客户ID` INT PRIMARY KEY AUTO_INCREMENT,
    `客户名称` VARCHAR(100) NOT NULL,
    `联系人` VARCHAR(50),
    `电话` VARCHAR(20),
    `地址` VARCHAR(200),
    `城市` VARCHAR(50),
    `省份` VARCHAR(50),
    `信用等级` ENUM('A', 'B', 'C', 'D') DEFAULT 'B',
    `注册时间` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_city (`城市`),
    INDEX idx_province (`省份`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建销售表
CREATE TABLE IF NOT EXISTS `销售` (
    `销售ID` INT PRIMARY KEY AUTO_INCREMENT,
    `产品ID` INT,
    `客户ID` INT,
    `销售日期` DATE NOT NULL,
    `数量` INT NOT NULL,
    `单价` DECIMAL(10, 2),
    `总金额` DECIMAL(12, 2),
    `销售员` VARCHAR(50),
    `状态` ENUM('待处理', '已完成', '已取消') DEFAULT '待处理',
    `创建时间` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`产品ID`) REFERENCES `产品`(`产品ID`),
    FOREIGN KEY (`客户ID`) REFERENCES `客户`(`客户ID`),
    INDEX idx_date (`销售日期`),
    INDEX idx_salesperson (`销售员`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 插入示例产品数据
INSERT INTO `产品` (`产品名称`, `类别`, `单价`, `库存量`) VALUES
('笔记本电脑 Pro', '电子产品', 8999.00, 50),
('无线鼠标', '电子产品', 199.00, 200),
('办公椅', '办公家具', 1299.00, 75),
('打印机', '办公设备', 2499.00, 30),
('咖啡机', '办公设备', 3999.00, 20),
('会议桌', '办公家具', 5999.00, 15),
('投影仪', '电子产品', 4999.00, 25),
('键盘', '电子产品', 599.00, 150),
('显示器', '电子产品', 2999.00, 60),
('文件柜', '办公家具', 1999.00, 40);

-- 插入示例客户数据
INSERT INTO `客户` (`客户名称`, `联系人`, `电话`, `地址`, `城市`, `省份`, `信用等级`) VALUES
('科技创新有限公司', '张经理', '13800138001', '中关村科技园A座', '北京', '北京', 'A'),
('互联网服务公司', '李总', '13900139002', '浦东新区软件园', '上海', '上海', 'A'),
('制造业集团', '王主任', '13700137003', '南山区科技园', '深圳', '广东', 'B'),
('贸易发展公司', '赵经理', '13600136004', '天河区商务中心', '广州', '广东', 'B'),
('教育科技公司', '钱总监', '13500135005', '西湖区文教路', '杭州', '浙江', 'A'),
('金融服务公司', '孙经理', '13400134006', '江北区金融街', '重庆', '重庆', 'A'),
('医疗健康公司', '周主管', '13300133007', '武昌区医疗园', '武汉', '湖北', 'B'),
('物流运输公司', '吴总', '13200132008', '雨花区物流园', '长沙', '湖南', 'C'),
('建筑工程公司', '郑经理', '13100131009', '历下区建筑路', '济南', '山东', 'B'),
('文化传媒公司', '冯总监', '13000130010', '朝阳区传媒园', '北京', '北京', 'A');

-- 插入示例销售数据（2025年的数据）
INSERT INTO `销售` (`产品ID`, `客户ID`, `销售日期`, `数量`, `单价`, `总金额`, `销售员`, `状态`) VALUES
(1, 1, '2025-01-15', 5, 8999.00, 44995.00, '张销售', '已完成'),
(2, 2, '2025-01-20', 20, 199.00, 3980.00, '李销售', '已完成'),
(3, 3, '2025-02-01', 10, 1299.00, 12990.00, '王销售', '已完成'),
(4, 4, '2025-02-15', 3, 2499.00, 7497.00, '赵销售', '已完成'),
(5, 5, '2025-03-01', 2, 3999.00, 7998.00, '钱销售', '已完成'),
(6, 6, '2025-03-15', 1, 5999.00, 5999.00, '孙销售', '已完成'),
(7, 7, '2025-04-01', 2, 4999.00, 9998.00, '周销售', '已完成'),
(8, 8, '2025-04-15', 15, 599.00, 8985.00, '吴销售', '已完成'),
(9, 9, '2025-05-01', 5, 2999.00, 14995.00, '郑销售', '已完成'),
(10, 10, '2025-05-15', 3, 1999.00, 5997.00, '冯销售', '已完成'),
(1, 2, '2025-06-01', 3, 8999.00, 26997.00, '张销售', '已完成'),
(3, 4, '2025-06-15', 5, 1299.00, 6495.00, '王销售', '已完成'),
(5, 6, '2025-07-01', 1, 3999.00, 3999.00, '钱销售', '已完成'),
(7, 8, '2025-07-15', 3, 4999.00, 14997.00, '周销售', '待处理'),
(9, 10, '2025-08-01', 2, 2999.00, 5998.00, '郑销售', '待处理');

-- 创建视图：月度销售汇总
CREATE OR REPLACE VIEW `月度销售汇总` AS
SELECT 
    DATE_FORMAT(`销售日期`, '%Y-%m') AS `月份`,
    COUNT(DISTINCT `客户ID`) AS `客户数`,
    COUNT(*) AS `订单数`,
    SUM(`数量`) AS `总销量`,
    SUM(`总金额`) AS `总销售额`,
    AVG(`总金额`) AS `平均订单金额`
FROM `销售`
WHERE `状态` = '已完成'
GROUP BY DATE_FORMAT(`销售日期`, '%Y-%m');

-- 创建视图：产品销售排行
CREATE OR REPLACE VIEW `产品销售排行` AS
SELECT 
    p.`产品名称`,
    p.`类别`,
    COUNT(s.`销售ID`) AS `销售次数`,
    SUM(s.`数量`) AS `总销量`,
    SUM(s.`总金额`) AS `总销售额`
FROM `产品` p
LEFT JOIN `销售` s ON p.`产品ID` = s.`产品ID` AND s.`状态` = '已完成'
GROUP BY p.`产品ID`, p.`产品名称`, p.`类别`
ORDER BY `总销售额` DESC;

-- 输出成功信息
SELECT '数据库初始化完成！' AS message;
SELECT COUNT(*) AS '产品数量' FROM `产品`;
SELECT COUNT(*) AS '客户数量' FROM `客户`;
SELECT COUNT(*) AS '销售记录' FROM `销售`;