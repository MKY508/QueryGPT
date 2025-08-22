#!/usr/bin/env python3
"""
遮挡截图中的敏感信息
"""
from PIL import Image, ImageDraw
import os

def mask_sensitive_areas(image_path, output_path):
    """遮挡图片中的敏感区域"""
    
    # 打开图片
    img = Image.open(image_path)
    draw = ImageDraw.Draw(img)
    
    # 获取图片尺寸
    width, height = img.size
    
    if "11.55.48" in image_path:
        # 第一张图：饼图中的图例文字
        # 遮挡右侧图例中的具体业务单位名称
        draw.rectangle([925, 365, 1135, 470], fill='black')
        
    elif "11.56.46" in image_path:
        # 第二张图：开发者视图中的代码
        # 遮挡代码中的业务单位名称
        draw.rectangle([200, 695, 1130, 720], fill='black')  # 业务单位名称行
        
    # 保存处理后的图片
    img.save(output_path)
    print(f"已处理并保存到: {output_path}")

# 处理截图
screenshots = [
    "/Users/maokaiyue/Documents/截屏2025-08-22 11.55.48.png",
    "/Users/maokaiyue/Documents/截屏2025-08-22 11.56.46.png"
]

for screenshot in screenshots:
    if os.path.exists(screenshot):
        output_name = screenshot.replace(".png", "_masked.png")
        mask_sensitive_areas(screenshot, output_name)
    else:
        print(f"文件不存在: {screenshot}")