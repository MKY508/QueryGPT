#!/bin/bash

# QueryGPT-github 仓库清理脚本
# 保留main分支，删除其他不必要的分支和PR

echo "开始清理 QueryGPT-github 仓库..."

# 切换到main分支
git checkout main

# 拉取最新的main分支
git pull origin main

# 删除远程的dependabot分支
echo "删除远程dependabot分支..."
git push origin --delete dependabot/pip/cryptography-46.0.1
git push origin --delete dependabot/pip/numpy-2.0.2

# 删除本地对应的远程跟踪分支
git branch -dr origin/dependabot/pip/cryptography-46.0.1
git branch -dr origin/dependabot/pip/numpy-2.0.2

# 清理本地无用的引用
git remote prune origin

# 检查最终状态
echo "清理完成！当前分支状态："
git branch -a

echo "仓库清理完成！只保留了main分支。"