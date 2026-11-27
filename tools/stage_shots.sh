#!/bin/bash
# Screenshots for one stage of a run, and before/after sheets against the stage before.
#
#   tools/stage_shots.sh v0.17 "v0.16" docs/progress/v0.16/after_
#
# Saves docs/progress/<version>/after_{postcard,aerial,single}.jpg (Postcard, Overview and a
# facade close-up; High, Hand-painted, Neutral, Midday) and three sheets
# {postcard,overview,facade}_before_after.jpg. The third argument is the path prefix of the
# previous stage's three pictures (docs/progress/base-v0.15/ for the v0.15 set).
set -e
cd "$(dirname "$0")/.."
ver=$1; prevName=$2; prev=$3
out=docs/progress/$ver
node tools/shot.cjs --out $out --tag after --views postcard,aerial,single --preset high --time midday --clean | tail -4
for pair in postcard:postcard aerial:overview single:facade; do
  v=${pair%%:*}; n=${pair##*:}
  python3 tools/side_by_side.py $out/${n}_before_after.jpg "$prevName=${prev}${v}.jpg" "$ver=$out/after_${v}.jpg" --height 540
done
ls $out
