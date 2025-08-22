#!/usr/bin/env python3
"""
使用macOS Preview应用添加黑色矩形来遮挡敏感信息
"""
import subprocess
import os

def create_masked_version_instructions():
    """生成处理说明"""
    
    instructions = """
    ========================================
    手动遮挡敏感信息的步骤：
    ========================================
    
    1. 第一张截图 (11.55.48.png) - 饼图：
       - 打开图片：双击图片用预览(Preview)打开
       - 点击工具栏的"标记"按钮（或按 Shift+Cmd+A）
       - 选择矩形工具
       - 设置填充颜色为黑色
       - 在右侧图例处画黑色矩形，遮挡业务单位名称：
         * "爆裂飞车:爆裂飞车4"
         * "超级飞侠:SUPER WINGS"
         * "超级飞侠:SUPER WINGS 3"
         * "超级飞侠:SUPER WINGS9"
         * "超级飞侠: 超级飞侠大电影"
       - 保存为新文件：文件 > 导出 > 命名为 "截屏2025-08-22 11.55.48_safe.png"
    
    2. 第二张截图 (11.56.46.png) - 开发者视图：
       - 打开图片：双击图片用预览(Preview)打开
       - 点击工具栏的"标记"按钮
       - 选择矩形工具，填充黑色
       - 在代码区域画黑色矩形，遮挡这一行：
         * "'超级飞侠:SUPER WINGS9','超级飞侠:SUPER WINGS 3','超级飞侠: 超级飞侠大电影','超级飞侠:SUPER WINGS','爆裂飞车:爆裂飞车4',"
       - 保存为新文件：文件 > 导出 > 命名为 "截屏2025-08-22 11.56.46_safe.png"
    
    3. 或者使用在线工具：
       - 访问 https://pixlr.com/x/
       - 上传图片
       - 使用矩形工具添加黑色矩形
       - 下载处理后的图片
    
    ========================================
    自动打开第一张图片...
    ========================================
    """
    
    print(instructions)
    
    # 自动打开第一张图片
    screenshot1 = "/Users/maokaiyue/Documents/截屏2025-08-22 11.55.48.png"
    if os.path.exists(screenshot1):
        subprocess.run(["open", screenshot1])
        print(f"已打开: {screenshot1}")
    
    # 打开第二张图片
    screenshot2 = "/Users/maokaiyue/Documents/截屏2025-08-22 11.56.46.png"
    if os.path.exists(screenshot2):
        subprocess.run(["open", screenshot2])
        print(f"已打开: {screenshot2}")

if __name__ == "__main__":
    create_masked_version_instructions()