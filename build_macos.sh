#!/bin/bash

echo "========================================"
echo "  QueryGPT macOS 打包脚本"
echo "========================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Python 环境
echo -e "${YELLOW}[1/8] 检查 Python 环境...${NC}"
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}错误: 未找到 Python 3，请先安装 Python 3.10+${NC}"
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
echo "当前 Python 版本: $PYTHON_VERSION"

# 安装打包依赖
echo -e "${YELLOW}[2/8] 安装打包工具...${NC}"
pip3 install pyinstaller pillow requests dmgbuild

# 创建应用图标
echo -e "${YELLOW}[3/8] 创建应用图标...${NC}"
if [ ! -f "docs/images/icon.icns" ]; then
    # 创建一个简单的图标
    python3 << EOF
from PIL import Image, ImageDraw, ImageFont
import os

# 创建图标图像
sizes = [16, 32, 64, 128, 256, 512, 1024]
images = []

for size in sizes:
    img = Image.new('RGBA', (size, size), (66, 135, 245, 255))
    draw = ImageDraw.Draw(img)
    
    # 在图标中心绘制 "Q"
    text = "Q"
    try:
        # 尝试使用系统字体
        font_size = int(size * 0.6)
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except:
        font = ImageFont.load_default()
    
    # 计算文本位置
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    position = ((size - text_width) // 2, (size - text_height) // 2)
    
    draw.text(position, text, fill='white', font=font)
    images.append(img)

# 保存为 ICO（用作临时格式）
os.makedirs('docs/images', exist_ok=True)
images[4].save('docs/images/icon.png', 'PNG')

# 使用 macOS 工具创建 icns
os.system('mkdir -p /tmp/QueryGPT.iconset')
for i, size in enumerate(sizes[:6]):  # 只使用前6个尺寸
    images[i].save(f'/tmp/QueryGPT.iconset/icon_{size}x{size}.png', 'PNG')
    images[i].save(f'/tmp/QueryGPT.iconset/icon_{size}x{size}@2x.png', 'PNG')

os.system('iconutil -c icns /tmp/QueryGPT.iconset -o docs/images/icon.icns')
os.system('rm -rf /tmp/QueryGPT.iconset')

print("图标创建成功")
EOF
fi

# 清理旧的构建
echo -e "${YELLOW}[4/8] 清理旧的构建文件...${NC}"
rm -rf build dist *.pyc __pycache__
rm -rf QueryGPT.app QueryGPT.dmg

# 开始打包
echo -e "${YELLOW}[5/8] 开始打包应用...${NC}"
pyinstaller querygpt.spec --clean --noconfirm

if [ $? -ne 0 ]; then
    echo -e "${RED}错误: 打包失败！${NC}"
    exit 1
fi

# 创建启动脚本
echo -e "${YELLOW}[6/8] 创建启动脚本...${NC}"
cat > dist/QueryGPT.app/Contents/MacOS/launch.sh << 'EOF'
#!/bin/bash

# 获取应用所在目录
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_RESOURCES="$APP_DIR/../Resources"

# 设置环境变量
export FLASK_APP="$APP_RESOURCES/backend/app.py"
export PYTHONPATH="$APP_RESOURCES:$PYTHONPATH"

# 检查是否已有实例在运行
if lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null ; then
    echo "QueryGPT 已经在运行"
    open http://localhost:5000
else
    # 启动应用
    cd "$APP_RESOURCES"
    
    # 创建日志目录
    mkdir -p ~/Library/Logs/QueryGPT
    
    # 启动服务器
    echo "正在启动 QueryGPT..."
    echo "访问地址: http://localhost:5000"
    
    # 等待一秒后自动打开浏览器
    (sleep 2 && open http://localhost:5000) &
    
    # 运行主程序
    "$APP_DIR/QueryGPT" > ~/Library/Logs/QueryGPT/app.log 2>&1
fi
EOF

chmod +x dist/QueryGPT.app/Contents/MacOS/launch.sh

# 创建 DMG 配置
echo -e "${YELLOW}[7/8] 配置 DMG 打包...${NC}"
cat > dmg_settings.py << 'EOF'
# -*- coding: utf-8 -*-
import os.path

# DMG 配置
application = 'dist/QueryGPT.app'
appname = 'QueryGPT'

# DMG 设置
filename = 'QueryGPT-1.0.0.dmg'
volume_name = 'QueryGPT Installer'
format = 'UDBZ'
size = None  # 自动计算大小

# 窗口设置
background = None  # 可以设置背景图片
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
sidebar_width = 180

# 窗口大小和位置
window_rect = ((100, 100), (640, 480))
default_view = 'icon-view'

# 图标视图设置
icon_size = 128
text_size = 16
icon_locations = {
    'QueryGPT.app': (140, 120),
    'Applications': (500, 120)
}

# 包含 Applications 快捷方式
symlinks = {'Applications': '/Applications'}

# 文件排列
arrange_by = None
grid_offset = (0, 0)
grid_spacing = 100
scroll_position = (0, 0)
label_pos = 'bottom'

# 许可协议（可选）
license = {
    'default-language': 'zh-CN',
    'licenses': {
        'zh-CN': '''QueryGPT 用户许可协议

本软件采用 MIT 许可证发布。

版权所有 (c) 2025 Mao Kaiyue

特此免费授予任何获得本软件副本和相关文档文件的人员不受限制地使用本软件的权利。
'''
    }
}
EOF

# 创建 DMG
echo -e "${YELLOW}[8/8] 创建 DMG 安装包...${NC}"
if command -v dmgbuild &> /dev/null; then
    dmgbuild -s dmg_settings.py "QueryGPT" QueryGPT-1.0.0.dmg
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ DMG 创建成功: QueryGPT-1.0.0.dmg${NC}"
    else
        echo -e "${YELLOW}⚠️  DMG 创建失败，但 .app 文件已生成${NC}"
    fi
else
    echo -e "${YELLOW}提示: dmgbuild 未安装，跳过 DMG 创建${NC}"
    echo "你可以手动创建 DMG："
    echo "1. 打开磁盘工具"
    echo "2. 文件 -> 新建映像 -> 来自文件夹的映像"
    echo "3. 选择 dist/QueryGPT.app"
fi

# 创建简单的 DMG（备选方案）
if [ ! -f "QueryGPT-1.0.0.dmg" ]; then
    echo -e "${YELLOW}使用备选方案创建 DMG...${NC}"
    
    # 创建临时 DMG
    hdiutil create -volname "QueryGPT" -srcfolder dist/QueryGPT.app -ov -format UDZO QueryGPT-1.0.0.dmg
fi

# 清理临时文件
rm -f dmg_settings.py
rm -f version_info.txt

echo ""
echo "========================================"
echo -e "${GREEN}  打包完成！${NC}"
echo "========================================"
echo ""
echo "生成的文件："
echo "  • 应用程序: dist/QueryGPT.app"
if [ -f "QueryGPT-1.0.0.dmg" ]; then
    echo "  • 安装包: QueryGPT-1.0.0.dmg"
    echo ""
    echo "安装方法："
    echo "  1. 双击 QueryGPT-1.0.0.dmg"
    echo "  2. 将 QueryGPT 拖动到 Applications 文件夹"
else
    echo ""
    echo "使用方法："
    echo "  1. 将 dist/QueryGPT.app 拖动到 Applications 文件夹"
fi
echo "  3. 从启动台或应用程序文件夹运行 QueryGPT"
echo ""
echo "首次运行会自动打开浏览器访问 http://localhost:5000"