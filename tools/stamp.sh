#!/bin/sh
# Give every local CSS/JS reference a fresh ?v= stamp so browsers fetch new files after a deploy.
# GitHub Pages lets browsers cache files for 10 minutes, and modules imported by other modules
# (styles.js, board.js…) can stay cached even after a reload. Run before committing a change.
set -e
cd "$(dirname "$0")/.."
v=$(date +%Y%m%d%H%M%S)
perl -pi -e "s/(href|src)=\"(style\.css|[a-z0-9-]+\.js)(\?v=\d+)?\"/\$1=\"\$2?v=$v\"/g" ./*.html
perl -pi -e "s/from '\.\/([a-z0-9-]+\.js)(\?v=\d+)?'/from '.\/\$1?v=$v'/g" ./*.js
echo "stamped $v"
