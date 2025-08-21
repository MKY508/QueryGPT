#!/bin/bash

echo "🚀 QueryGPT Desktop Builder"
echo "=========================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js"
    exit 1
fi

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 未安装，请先安装 Python 3.10+"
    exit 1
fi

# 安装 Node 依赖
echo "📦 安装依赖..."
npm install

# 创建默认图标（如果不存在）
if [ ! -f "build/icon.png" ]; then
    echo "🎨 创建默认图标..."
    # 创建一个简单的 PNG 图标
    python3 -c "
from PIL import Image, ImageDraw, ImageFont
import os

# 创建图标
img = Image.new('RGBA', (512, 512), (102, 126, 234, 255))
draw = ImageDraw.Draw(img)

# 添加文字
try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 200)
except:
    font = None

text = 'Q'
bbox = draw.textbbox((0, 0), text, font=font) if font else (0, 0, 200, 200)
text_width = bbox[2] - bbox[0]
text_height = bbox[3] - bbox[1]
x = (512 - text_width) // 2
y = (512 - text_height) // 2 - 20
draw.text((x, y), text, fill='white', font=font)

# 保存
os.makedirs('build', exist_ok=True)
img.save('build/icon.png')
print('✅ 图标创建成功')
    " 2>/dev/null || {
        echo "⚠️  无法自动创建图标，请手动添加 build/icon.png"
    }
fi

# 转换图标格式
if [ -f "build/icon.png" ]; then
    echo "🔄 转换图标格式..."
    
    # macOS .icns
    if [[ "$OSTYPE" == "darwin"* ]]; then
        mkdir -p build/icon.iconset
        sips -z 16 16     build/icon.png --out build/icon.iconset/icon_16x16.png
        sips -z 32 32     build/icon.png --out build/icon.iconset/icon_16x16@2x.png
        sips -z 32 32     build/icon.png --out build/icon.iconset/icon_32x32.png
        sips -z 64 64     build/icon.png --out build/icon.iconset/icon_32x32@2x.png
        sips -z 128 128   build/icon.png --out build/icon.iconset/icon_128x128.png
        sips -z 256 256   build/icon.png --out build/icon.iconset/icon_128x128@2x.png
        sips -z 256 256   build/icon.png --out build/icon.iconset/icon_256x256.png
        sips -z 512 512   build/icon.png --out build/icon.iconset/icon_256x256@2x.png
        sips -z 512 512   build/icon.png --out build/icon.iconset/icon_512x512.png
        sips -z 1024 1024 build/icon.png --out build/icon.iconset/icon_512x512@2x.png
        iconutil -c icns build/icon.iconset -o build/icon.icns
        rm -rf build/icon.iconset
        echo "✅ macOS 图标创建成功"
    fi
    
    # Windows .ico (需要 ImageMagick)
    if command -v convert &> /dev/null; then
        convert build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
        echo "✅ Windows 图标创建成功"
    else
        echo "⚠️  未安装 ImageMagick，跳过 .ico 图标创建"
    fi
fi

# 选择构建平台
echo ""
echo "选择构建平台："
echo "1) macOS (.dmg)"
echo "2) Windows (.exe)"
echo "3) Linux (.AppImage)"
echo "4) 所有平台"
read -p "请选择 (1-4): " choice

case $choice in
    1)
        echo "🍎 构建 macOS 版本..."
        npm run build-mac
        ;;
    2)
        echo "🪟 构建 Windows 版本..."
        npm run build-win
        ;;
    3)
        echo "🐧 构建 Linux 版本..."
        npm run build-linux
        ;;
    4)
        echo "📦 构建所有平台..."
        npm run build-all
        ;;
    *)
        echo "❌ 无效选择"
        exit 1
        ;;
esac

echo ""
echo "✅ 构建完成！"
echo "📁 输出文件在 dist/ 目录中"