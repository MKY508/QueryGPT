#!/bin/bash

echo "创建 QueryGPT macOS 应用..."

# 应用名称和版本
APP_NAME="QueryGPT"
VERSION="1.0.0"
BUNDLE_ID="com.maokaiyue.querygpt"

# 创建应用目录结构
APP_DIR="$APP_NAME.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# 复制项目文件到 Resources
echo "复制项目文件..."
cp -r backend "$APP_DIR/Contents/Resources/"
cp -r frontend "$APP_DIR/Contents/Resources/"
cp requirements.txt "$APP_DIR/Contents/Resources/"
cp QueryGPT.command "$APP_DIR/Contents/Resources/"
cp -r docs "$APP_DIR/Contents/Resources/" 2>/dev/null || true

# 创建启动脚本
cat > "$APP_DIR/Contents/MacOS/$APP_NAME" << 'EOF'
#!/bin/bash

# 获取应用资源目录
APP_RESOURCES="$(dirname "$0")/../Resources"
cd "$APP_RESOURCES"

# 在新的终端窗口中运行
osascript <<END
tell application "Terminal"
    do script "cd '$APP_RESOURCES' && ./QueryGPT.command"
    activate
end tell
END
EOF

chmod +x "$APP_DIR/Contents/MacOS/$APP_NAME"

# 创建 Info.plist
cat > "$APP_DIR/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>
    <string>$APP_NAME - 智能数据分析平台</string>
    <key>CFBundleIdentifier</key>
    <string>$BUNDLE_ID</string>
    <key>CFBundleVersion</key>
    <string>$VERSION</string>
    <key>CFBundleShortVersionString</key>
    <string>$VERSION</string>
    <key>CFBundleExecutable</key>
    <string>$APP_NAME</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.13.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.developer-tools</string>
    <key>NSRequiresAquaSystemAppearance</key>
    <false/>
</dict>
</plist>
EOF

# 创建图标（如果存在）
if [ -f "docs/images/icon.icns" ]; then
    cp "docs/images/icon.icns" "$APP_DIR/Contents/Resources/icon.icns"
    # 在 plist 中添加图标引用
    /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string icon" "$APP_DIR/Contents/Info.plist" 2>/dev/null || true
fi

echo "✅ 应用创建成功: $APP_DIR"
echo ""
echo "使用方法："
echo "1. 双击 $APP_NAME.app 运行"
echo "2. 或拖动到 Applications 文件夹"
echo ""
echo "注意：首次运行会自动安装依赖"