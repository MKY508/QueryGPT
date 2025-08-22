#!/bin/bash

# QueryGPT Docker 启动脚本
# 提供简单的 Docker 环境管理命令

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 显示帮助信息
show_help() {
    echo "QueryGPT Docker 管理脚本"
    echo ""
    echo "用法: ./docker-start.sh [命令] [选项]"
    echo ""
    echo "命令:"
    echo "  build       构建 Docker 镜像"
    echo "  up          启动服务（包含数据库）"
    echo "  up-dev      启动开发环境（连接外部数据库）"
    echo "  down        停止并删除容器"
    echo "  restart     重启服务"
    echo "  logs        查看日志"
    echo "  shell       进入容器 shell"
    echo "  clean       清理所有容器和镜像"
    echo "  status      查看服务状态"
    echo ""
    echo "示例:"
    echo "  ./docker-start.sh build      # 构建镜像"
    echo "  ./docker-start.sh up         # 启动服务"
    echo "  ./docker-start.sh up-dev     # 启动开发环境"
    echo "  ./docker-start.sh logs       # 查看日志"
}

# 检查 .env 文件
check_env() {
    if [ ! -f ".env" ]; then
        echo -e "${YELLOW}警告: .env 文件不存在${NC}"
        echo "正在从 .env.example 创建 .env 文件..."
        cp .env.example .env
        echo -e "${GREEN}✓ 已创建 .env 文件${NC}"
        echo -e "${YELLOW}请编辑 .env 文件配置您的 API 密钥和数据库信息${NC}"
        exit 1
    fi
}

# 构建 Docker 镜像
build_image() {
    echo -e "${GREEN}构建 Docker 镜像...${NC}"
    docker-compose build
    echo -e "${GREEN}✓ 镜像构建完成${NC}"
}

# 启动服务（生产环境）
start_services() {
    check_env
    echo -e "${GREEN}启动 QueryGPT 服务...${NC}"
    docker-compose up -d
    echo -e "${GREEN}✓ 服务已启动${NC}"
    echo ""
    echo "服务地址:"
    echo "  QueryGPT: http://localhost:5007"
    echo "  MySQL:    localhost:3307"
    echo ""
    echo "使用 './docker-start.sh logs' 查看日志"
}

# 启动开发环境
start_dev() {
    check_env
    echo -e "${GREEN}启动开发环境...${NC}"
    docker-compose -f docker-compose.dev.yml up -d
    echo -e "${GREEN}✓ 开发环境已启动${NC}"
    echo ""
    echo "服务地址: http://localhost:5007"
    echo "注意: 开发模式连接到外部数据库"
    echo ""
    echo "使用 './docker-start.sh logs' 查看日志"
}

# 停止服务
stop_services() {
    echo -e "${YELLOW}停止服务...${NC}"
    docker-compose down
    echo -e "${GREEN}✓ 服务已停止${NC}"
}

# 重启服务
restart_services() {
    stop_services
    start_services
}

# 查看日志
show_logs() {
    docker-compose logs -f querygpt
}

# 进入容器 shell
enter_shell() {
    echo "进入 QueryGPT 容器..."
    docker-compose exec querygpt /bin/bash
}

# 清理所有容器和镜像
clean_all() {
    echo -e "${RED}警告: 这将删除所有 QueryGPT 相关的容器和镜像${NC}"
    read -p "确定要继续吗? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker-compose down -v --rmi all
        echo -e "${GREEN}✓ 清理完成${NC}"
    else
        echo "操作已取消"
    fi
}

# 查看服务状态
show_status() {
    echo -e "${GREEN}QueryGPT 服务状态:${NC}"
    docker-compose ps
    echo ""
    echo -e "${GREEN}健康检查状态:${NC}"
    docker-compose ps | grep -E "healthy|unhealthy" || echo "服务正在启动..."
}

# 主程序
case "$1" in
    build)
        build_image
        ;;
    up)
        start_services
        ;;
    up-dev)
        start_dev
        ;;
    down)
        stop_services
        ;;
    restart)
        restart_services
        ;;
    logs)
        show_logs
        ;;
    shell)
        enter_shell
        ;;
    clean)
        clean_all
        ;;
    status)
        show_status
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        if [ -z "$1" ]; then
            # 默认行为：构建并启动
            build_image
            start_services
        else
            echo -e "${RED}未知命令: $1${NC}"
            echo ""
            show_help
            exit 1
        fi
        ;;
esac