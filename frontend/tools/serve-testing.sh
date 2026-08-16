#!/usr/bin/env bash
# Serve the built game + a mock RGS (real books) for phone/local testing.
# The game then plays byte-identical to Stake. Ctrl-C stops both.
set -e
cd "$(dirname "$0")/.."

RGS_PORT=8787
WEB_PORT=5174
IP=$(hostname -I 2>/dev/null | awk '{print $1}')

npm run build >/dev/null 2>&1 || npm run build

python3 tools/mock-rgs.py --port "$RGS_PORT" &
RGS_PID=$!
npx vite preview --host 0.0.0.0 --port "$WEB_PORT" --strictPort >/dev/null 2>&1 &
WEB_PID=$!
trap 'kill $RGS_PID $WEB_PID 2>/dev/null' EXIT
sleep 2

echo ""
echo "  PLAY (real books via mock RGS):"
echo "  http://$IP:$WEB_PORT/?rgs_url=http://$IP:$RGS_PORT&sessionID=dev&currency=USD"
echo ""
echo "  Force a max win on the NEXT Big Dig (open in a tab, then buy Big Dig):"
echo "  http://$IP:$RGS_PORT/force?mode=feature_bigdig&min=15000"
echo ""
echo "  Ctrl-C to stop."
wait
