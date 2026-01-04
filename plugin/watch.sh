#!/bin/bash

# MODE=${1:-prod}
MODE=${1}

case $MODE in
  prod)
    SCRIPT="./build_and_copy_plugin_prod.sh"
    ;;
  test)
    SCRIPT="./build_and_copy_plugin_test.sh"
    ;;
  *)
    echo "Usage: $0 [prod|test]"
    echo "  prod - production build (default)"
    echo "  test - test build"
    exit 1
    ;;
esac

npx nodemon --exec "$SCRIPT" --watch src --ext js,ts,vue
