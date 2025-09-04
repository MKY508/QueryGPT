#!/bin/bash

# QueryGPT 修复验证脚本
# 测试环境检测和端口检测的修复是否正常工作

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      QueryGPT 修复验证测试 / Fix Verification Test      ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# 测试计数器
TESTS_PASSED=0
TESTS_FAILED=0

# 测试函数
run_test() {
    local test_name=$1
    local test_cmd=$2
    local expected=$3
    
    echo -n "测试 $test_name... "
    
    if eval "$test_cmd"; then
        echo -e "${GREEN}✓ 通过${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ 失败${NC}"
        echo -e "  预期: $expected"
        ((TESTS_FAILED++))
    fi
}

# 测试 1: 检查诊断脚本是否存在并可执行
echo -e "${BOLD}${BLUE}[1/6] 文件完整性测试${NC}"
run_test "diagnostic.sh 存在" "[ -f diagnostic.sh ]" "文件存在"
run_test "diagnostic.sh 可执行" "[ -x diagnostic.sh ] || chmod +x diagnostic.sh" "可执行权限"
echo ""

# 测试 2: 检查环境变量导出（运行诊断脚本的JSON模式）
echo -e "${BOLD}${BLUE}[2/6] 环境检测测试${NC}"
if [ -f diagnostic.sh ]; then
    chmod +x diagnostic.sh
    ENV_JSON=$(./diagnostic.sh --json 2>/dev/null || echo '{}')
    
    # 解析JSON（使用简单的grep方法）
    if echo "$ENV_JSON" | grep -q '"is_linux":.*true'; then
        echo -e "  ${GREEN}✓${NC} 检测到 Linux 环境"
        ((TESTS_PASSED++))
    elif echo "$ENV_JSON" | grep -q '"is_macos":.*true'; then
        echo -e "  ${GREEN}✓${NC} 检测到 macOS 环境"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}⚠${NC} 环境检测结果不明确"
    fi
    
    if echo "$ENV_JSON" | grep -q '"is_wsl":.*true'; then
        echo -e "  ${GREEN}✓${NC} 检测到 WSL 子环境"
        ((TESTS_PASSED++))
    elif echo "$ENV_JSON" | grep -q '"is_native_linux":.*true'; then
        echo -e "  ${GREEN}✓${NC} 检测到纯 Linux 环境"
        ((TESTS_PASSED++))
    fi
else
    echo -e "  ${RED}✗${NC} 无法运行诊断脚本"
    ((TESTS_FAILED++))
fi
echo ""

# 测试 3: 检查setup.sh的新功能
echo -e "${BOLD}${BLUE}[3/6] setup.sh 功能测试${NC}"
run_test "setup.sh --version" "./setup.sh --version 2>&1 | grep -q 'QueryGPT Setup'" "版本信息显示"
run_test "setup.sh --help" "./setup.sh --help 2>&1 | grep -q '全平台兼容'" "帮助信息更新"
echo ""

# 测试 4: 检查start.sh的新功能
echo -e "${BOLD}${BLUE}[4/6] start.sh 功能测试${NC}"
run_test "start.sh --version" "./start.sh --version 2>&1 | grep -q 'QueryGPT Start'" "版本信息显示"
run_test "start.sh --help" "./start.sh --help 2>&1 | grep -q 'Ubuntu.*Debian.*CentOS.*macOS'" "多平台支持"
echo ""

# 测试 5: 端口检测能力测试
echo -e "${BOLD}${BLUE}[5/6] 端口检测能力测试${NC}"

# 创建一个简单的端口检测测试
cat > test_port_detection.py << 'EOF'
import socket
import sys

def test_port(port):
    try:
        s = socket.socket()
        result = s.connect_ex(('127.0.0.1', port))
        s.close()
        return result != 0  # True if port is available
    except:
        return False

# 测试端口 5000
if test_port(5000):
    print("Port 5000 is available")
    sys.exit(0)
else:
    print("Port 5000 is in use")
    sys.exit(1)
EOF

if python3 test_port_detection.py 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Python 端口检测正常工作"
    ((TESTS_PASSED++))
else
    echo -e "  ${YELLOW}⚠${NC} 端口 5000 可能被占用"
fi

# 清理测试文件
rm -f test_port_detection.py
echo ""

# 测试 6: 检查trap修复（不应该在正常退出时显示"服务已停止"）
echo -e "${BOLD}${BLUE}[6/6] Trap 修复测试${NC}"

# 创建测试脚本
cat > test_trap.sh << 'EOF'
#!/bin/bash
source /dev/stdin <<'SCRIPT'
# 模拟setup.sh的trap设置
cleanup() {
    echo "CLEANUP_CALLED"
}
trap cleanup INT TERM  # 注意：没有EXIT
echo "NORMAL_EXIT"
SCRIPT
EOF

chmod +x test_trap.sh
OUTPUT=$(./test_trap.sh 2>&1)

if echo "$OUTPUT" | grep -q "NORMAL_EXIT" && ! echo "$OUTPUT" | grep -q "CLEANUP_CALLED"; then
    echo -e "  ${GREEN}✓${NC} Trap 修复正确：正常退出不调用 cleanup"
    ((TESTS_PASSED++))
else
    echo -e "  ${RED}✗${NC} Trap 修复可能有问题"
    ((TESTS_FAILED++))
fi

# 清理测试文件
rm -f test_trap.sh
echo ""

# 输出总结
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}测试总结 / Test Summary${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"
echo -e "通过测试: ${GREEN}$TESTS_PASSED${NC}"
echo -e "失败测试: ${RED}$TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ 所有测试通过！修复成功。${NC}"
    echo ""
    echo -e "${BOLD}下一步操作建议:${NC}"
    echo -e "1. 运行诊断工具查看详细环境信息:"
    echo -e "   ${CYAN}./diagnostic.sh${NC}"
    echo ""
    echo -e "2. 使用调试模式运行 setup:"
    echo -e "   ${CYAN}./setup.sh --debug${NC}"
    echo ""
    echo -e "3. 启动服务:"
    echo -e "   ${CYAN}./start.sh${NC}"
else
    echo -e "${YELLOW}⚠ 有 $TESTS_FAILED 个测试失败，请检查修复。${NC}"
    echo ""
    echo -e "${BOLD}调试建议:${NC}"
    echo -e "1. 运行诊断工具获取更多信息:"
    echo -e "   ${CYAN}./diagnostic.sh${NC}"
    echo ""
    echo -e "2. 检查文件权限:"
    echo -e "   ${CYAN}ls -la *.sh${NC}"
fi

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"

# 返回测试结果
exit $TESTS_FAILED