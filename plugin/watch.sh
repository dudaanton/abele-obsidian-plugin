#!/bin/bash

npx nodemon --exec "./build_and_copy_plugin_prod.sh" --watch src --ext js,ts,vue
