#!/usr/bin/env bash
set -euo pipefail
script_path=${BASH_SOURCE[0]}
if [[ $script_path == */* ]]; then cd -- "${script_path%/*}"; fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js가 없습니다. https://nodejs.org/ 에서 Node.js 22 이상 LTS를 설치하고 터미널을 다시 여세요.' >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  printf '%s\n' 'Node.js 22 이상이 필요합니다. https://nodejs.org/ 에서 LTS를 설치하고 다시 실행하세요.' >&2
  exit 1
fi
for arg in "$@"; do
  case "$arg" in
    --help|-h|--status|--check) exec node cli.mjs "$@" ;;
  esac
done
if [[ ! -d node_modules/playwright ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    printf '%s\n' 'npm이 없습니다. https://nodejs.org/ 에서 Node.js LTS를 npm과 함께 다시 설치하세요.' >&2
    exit 1
  fi
  printf '%s\n' '처음 실행에 필요한 패키지를 설치합니다 (npm ci). 인터넷 연결이 필요합니다.'
  if ! npm ci; then
    printf '%s\n' '설치 실패: 인터넷 연결과 폴더 쓰기 권한을 확인하고 다시 실행하세요. 터미널에서 npm ci로 다시 시도할 수 있습니다.' >&2
    exit 1
  fi
fi
exec node cli.mjs "$@"
