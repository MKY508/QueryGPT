# QueryGPT-github 仓库清理指南

## 已完成的本地清理

✅ **本地分支清理完成**
- 保留：`main` 分支（主分支）
- 已删除：`backup-before-cleanup` 分支

## 需要手动完成的远程清理

### 1. 设置GitHub认证

首先需要设置GitHub Personal Access Token：

```bash
# 选项1：使用GitHub CLI
gh auth login

# 选项2：设置Git认证（推荐）
git config --global user.name "your-username"
git config --global user.email "your-email@example.com"
# 然后在推送时使用Personal Access Token作为密码
```

### 2. 删除远程分支

```bash
# 运行清理脚本
./cleanup_branches.sh
```

或者手动执行：

```bash
# 删除dependabot分支
git push origin --delete dependabot/pip/cryptography-46.0.1
git push origin --delete dependabot/pip/numpy-2.0.2
```

### 3. 关闭不必要的PR

在GitHub网页上手动操作：
1. 访问：https://github.com/MKY508/QueryGPT/pulls
2. 关闭与dependabot分支相关的PR
3. 如果有其他不需要的PR，也一并关闭

### 4. 验证清理结果

```bash
# 检查剩余分支
git branch -a

# 应该只看到：
# * main
# remotes/origin/HEAD -> origin/main
# remotes/origin/main
```

## 清理后的仓库状态

- **保留分支**：只有 `main` 分支
- **删除分支**：所有dependabot和其他不必要的分支
- **PR状态**：关闭所有不必要的Pull Request

## 注意事项

1. 确保main分支是最新的，包含了所有重要的更改
2. 如果有未合并的有用PR，先合并后再删除对应分支
3. 定期清理可以保持仓库整洁，避免分支过多的问题