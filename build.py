#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QueryGPT 跨平台打包脚本
支持 Windows (.exe), macOS (.app/.dmg), Linux (AppImage)
"""

import os
import sys
import platform
import subprocess
import shutil
from pathlib import Path

class QueryGPTBuilder:
    def __init__(self):
        self.root_dir = Path(__file__).parent.absolute()
        self.system = platform.system().lower()
        self.version = "1.0.0"
        
    def check_requirements(self):
        """检查构建环境"""
        print("🔍 检查构建环境...")
        
        # 检查 Python 版本
        python_version = sys.version_info
        if python_version.major < 3 or python_version.minor < 10:
            print("❌ 需要 Python 3.10 或更高版本")
            return False
            
        # 检查 PyInstaller
        try:
            import PyInstaller
            print(f"✅ PyInstaller 版本: {PyInstaller.__version__}")
        except ImportError:
            print("📦 安装 PyInstaller...")
            subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"])
            
        return True
    
    def install_dependencies(self):
        """安装项目依赖"""
        print("\n📦 安装项目依赖...")
        requirements_file = self.root_dir / "requirements.txt"
        
        if requirements_file.exists():
            subprocess.run([
                sys.executable, "-m", "pip", "install", "-r", str(requirements_file)
            ])
        else:
            print("⚠️  未找到 requirements.txt")
    
    def create_icon(self):
        """创建应用图标"""
        print("\n🎨 创建应用图标...")
        
        try:
            from PIL import Image, ImageDraw, ImageFont
        except ImportError:
            subprocess.run([sys.executable, "-m", "pip", "install", "pillow"])
            from PIL import Image, ImageDraw, ImageFont
        
        # 确保图标目录存在
        icon_dir = self.root_dir / "docs" / "images"
        icon_dir.mkdir(parents=True, exist_ok=True)
        
        # 创建基础图标
        size = 512
        img = Image.new('RGBA', (size, size), (66, 135, 245, 255))
        draw = ImageDraw.Draw(img)
        
        # 绘制 "Q" 字母
        text = "Q"
        font_size = int(size * 0.6)
        
        try:
            # 尝试使用系统字体
            if self.system == "darwin":
                font_path = "/System/Library/Fonts/Helvetica.ttc"
            elif self.system == "windows":
                font_path = "C:/Windows/Fonts/Arial.ttf"
            else:
                font_path = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
            
            if os.path.exists(font_path):
                font = ImageFont.truetype(font_path, font_size)
            else:
                font = ImageFont.load_default()
        except:
            font = ImageFont.load_default()
        
        # 计算文本位置并绘制
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        position = ((size - text_width) // 2, (size - text_height) // 2)
        draw.text(position, text, fill='white', font=font)
        
        # 保存不同格式
        if self.system == "windows":
            img.save(icon_dir / "icon.ico", "ICO")
        elif self.system == "darwin":
            img.save(icon_dir / "icon.png", "PNG")
            # macOS 需要 icns 格式，使用系统工具转换
            self._create_icns(img, icon_dir / "icon.icns")
        else:
            img.save(icon_dir / "icon.png", "PNG")
        
        print("✅ 图标创建成功")
    
    def _create_icns(self, image, output_path):
        """创建 macOS icns 图标"""
        if self.system != "darwin":
            return
            
        from PIL import Image
        import tempfile
        iconset_dir = Path(tempfile.mkdtemp()) / "icon.iconset"
        iconset_dir.mkdir()
        
        # 创建不同尺寸的图标
        sizes = [16, 32, 64, 128, 256, 512]
        for size in sizes:
            resized = image.resize((size, size), Image.Resampling.LANCZOS)
            resized.save(iconset_dir / f"icon_{size}x{size}.png", "PNG")
            # Retina 版本
            resized.save(iconset_dir / f"icon_{size}x{size}@2x.png", "PNG")
        
        # 使用 iconutil 创建 icns
        subprocess.run([
            "iconutil", "-c", "icns", str(iconset_dir), "-o", str(output_path)
        ])
        
        # 清理临时文件
        shutil.rmtree(iconset_dir.parent)
    
    def build(self):
        """执行构建"""
        print(f"\n🔨 开始构建 {self.system.title()} 版本...")
        
        # 清理旧的构建
        for dir_name in ["build", "dist"]:
            dir_path = self.root_dir / dir_name
            if dir_path.exists():
                shutil.rmtree(dir_path)
        
        # 运行 PyInstaller
        spec_file = self.root_dir / "querygpt.spec"
        result = subprocess.run([
            sys.executable, "-m", "PyInstaller",
            str(spec_file),
            "--clean",
            "--noconfirm"
        ])
        
        if result.returncode != 0:
            print("❌ 构建失败")
            return False
        
        print("✅ 构建成功")
        return True
    
    def package(self):
        """创建安装包"""
        print(f"\n📦 创建 {self.system.title()} 安装包...")
        
        if self.system == "darwin":
            self.create_dmg()
        elif self.system == "windows":
            self.create_installer()
        else:
            self.create_appimage()
    
    def create_dmg(self):
        """创建 macOS DMG"""
        if self.system != "darwin":
            return
            
        app_path = self.root_dir / "dist" / "QueryGPT.app"
        dmg_path = self.root_dir / f"QueryGPT-{self.version}.dmg"
        
        if not app_path.exists():
            print("❌ 未找到 QueryGPT.app")
            return
        
        # 使用 hdiutil 创建 DMG
        print("正在创建 DMG...")
        subprocess.run([
            "hdiutil", "create",
            "-volname", "QueryGPT",
            "-srcfolder", str(app_path),
            "-ov",
            "-format", "UDZO",
            str(dmg_path)
        ])
        
        if dmg_path.exists():
            print(f"✅ DMG 创建成功: {dmg_path}")
            print(f"   文件大小: {dmg_path.stat().st_size / 1024 / 1024:.2f} MB")
    
    def create_installer(self):
        """创建 Windows 安装程序"""
        if self.system != "windows":
            return
            
        exe_path = self.root_dir / "dist" / "QueryGPT.exe"
        
        if not exe_path.exists():
            print("❌ 未找到 QueryGPT.exe")
            return
        
        # 创建启动批处理
        batch_content = """@echo off
title QueryGPT - 智能数据分析平台
echo ========================================
echo   QueryGPT 正在启动...
echo ========================================
echo.
echo 访问地址: http://localhost:5000
echo 按 Ctrl+C 关闭服务器
echo.
start http://localhost:5000
QueryGPT.exe
pause"""
        
        batch_path = self.root_dir / "dist" / "启动QueryGPT.bat"
        batch_path.write_text(batch_content, encoding='utf-8')
        
        print(f"✅ Windows 版本打包成功")
        print(f"   可执行文件: {exe_path}")
        print(f"   启动脚本: {batch_path}")
    
    def create_appimage(self):
        """创建 Linux AppImage"""
        print("ℹ️  Linux AppImage 创建功能开发中...")
    
    def run(self):
        """运行完整的构建流程"""
        print("=" * 50)
        print("  QueryGPT 自动打包工具")
        print(f"  系统: {platform.system()} {platform.machine()}")
        print(f"  Python: {platform.python_version()}")
        print("=" * 50)
        
        if not self.check_requirements():
            return
        
        self.install_dependencies()
        self.create_icon()
        
        if self.build():
            self.package()
            
            print("\n" + "=" * 50)
            print("  ✅ 打包完成！")
            print("=" * 50)
            
            # 显示输出文件
            dist_dir = self.root_dir / "dist"
            if dist_dir.exists():
                print("\n生成的文件:")
                for file in dist_dir.iterdir():
                    size = file.stat().st_size / 1024 / 1024
                    print(f"  • {file.name} ({size:.2f} MB)")
            
            print("\n使用说明:")
            if self.system == "darwin":
                print("  1. 双击 DMG 文件")
                print("  2. 将 QueryGPT 拖动到 Applications")
                print("  3. 从启动台运行 QueryGPT")
            elif self.system == "windows":
                print("  1. 双击 启动QueryGPT.bat")
                print("  2. 浏览器会自动打开")
            else:
                print("  1. 运行 ./QueryGPT")
                print("  2. 访问 http://localhost:5000")

if __name__ == "__main__":
    builder = QueryGPTBuilder()
    builder.run()