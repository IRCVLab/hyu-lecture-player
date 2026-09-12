#!/bin/bash
script_path=${BASH_SOURCE[0]}
if [[ $script_path == */* ]]; then cd -- "${script_path%/*}" || exit 1; fi
/bin/bash ./run.sh "$@"
result=$?
if [[ $# -eq 0 && -t 0 ]]; then
  printf '\n%s' '창을 닫으려면 Enter를 누르세요: '
  read -r _reply
fi
exit "$result"
