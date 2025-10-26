#!/bin/bash

# Test View API endpoints for ugc-compute
# Make sure dev server is running: npm run dev

BASE_URL="http://localhost:3000"

echo "========================================="
echo "Testing UGC Compute - View APIs"
echo "========================================="
echo ""

echo "=== 1. Testing YouTube Views GET (Test Endpoint) ==="
curl -s http://localhost:3000/api/youtube-views | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3000/api/youtube-views
echo ""
echo ""

echo "=== 2. Testing YouTube Views POST (Single Video) ==="
curl -s -X POST "$BASE_URL/api/youtube-views" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]}' | python3 -m json.tool 2>/dev/null || curl -s -X POST "$BASE_URL/api/youtube-views" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]}'
echo ""
echo ""

echo "=== 3. Testing YouTube Views POST (Multiple Videos) ==="
curl -s -X POST "$BASE_URL/api/youtube-views" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=jNQXAC9IVRw"]}' | python3 -m json.tool 2>/dev/null || curl -s -X POST "$BASE_URL/api/youtube-views" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=jNQXAC9IVRw"]}'
echo ""
echo ""

echo "=== 4. Testing TikTok Views POST (requires Peekalink API key) ==="
curl -s -X POST "$BASE_URL/api/tiktok-views" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://www.tiktok.com/@example/video/123456"]}'
echo ""
echo ""

echo "========================================="
echo "Testing complete!"
echo "========================================="

