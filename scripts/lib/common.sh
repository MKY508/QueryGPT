RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

check_command() {
  command -v "$1" >/dev/null 2>&1
}

checksum_file() {
  local file="$1"
  if check_command shasum; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif check_command sha256sum; then
    sha256sum "$file" | awk '{print $1}'
  else
    cksum "$file" | awk '{print $1}'
  fi
}

summarize_command() {
  local command_line="$1"
  command_line="$(echo "$command_line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  if [ -z "$command_line" ]; then
    echo "-"
    return 0
  fi

  if [ "${#command_line}" -gt 140 ]; then
    echo "${command_line:0:137}..."
  else
    echo "$command_line"
  fi
}
