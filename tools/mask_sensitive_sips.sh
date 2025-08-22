#!/bin/bash

# 使用macOS的sips工具和ImageMagick处理图片
# 如果没有ImageMagick，可以使用brew install imagemagick安装

# 检查ImageMagick是否安装
if ! command -v convert &> /dev/null; then
    echo "需要安装ImageMagick，请运行: brew install imagemagick"
    exit 1
fi

# 处理第一张截图 - 饼图
if [ -f "/Users/maokaiyue/Documents/截屏2025-08-22 11.55.48.png" ]; then
    echo "处理第一张截图..."
    convert "/Users/maokaiyue/Documents/截屏2025-08-22 11.55.48.png" \
        -fill black \
        -draw "rectangle 925,365 1135,470" \
        "/Users/maokaiyue/Documents/截屏2025-08-22 11.55.48_masked.png"
    echo "已保存到: /Users/maokaiyue/Documents/截屏2025-08-22 11.55.48_masked.png"
fi

# 处理第二张截图 - 开发者视图
if [ -f "/Users/maokaiyue/Documents/截屏2025-08-22 11.56.46.png" ]; then
    echo "处理第二张截图..."
    convert "/Users/maokaiyue/Documents/截屏2025-08-22 11.56.46.png" \
        -fill black \
        -draw "rectangle 200,695 1130,720" \
        "/Users/maokaiyue/Documents/截屏2025-08-22 11.56.46_masked.png"
    echo "已保存到: /Users/maokaiyue/Documents/截屏2025-08-22 11.56.46_masked.png"
fi

echo "处理完成！"