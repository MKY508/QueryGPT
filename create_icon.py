#!/usr/bin/env python3
import os

# 创建一个简单的 SVG 图标
svg_content = '''<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="100" fill="#667eea"/>
  <text x="256" y="320" font-size="200" fill="white" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold">Q</text>
</svg>'''

os.makedirs('build', exist_ok=True)

# 保存 SVG
with open('build/icon.svg', 'w') as f:
    f.write(svg_content)

print("✅ 创建了 build/icon.svg")
print("请手动转换为 .png/.ico/.icns 格式，或使用在线工具：")
print("https://cloudconvert.com/svg-to-png")
print("https://cloudconvert.com/png-to-ico")
print("https://cloudconvert.com/png-to-icns")