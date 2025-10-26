#!/bin/bash

# Test View API endpoints
# Make sure to run: npm run dev first
# Make sure to add your API keys to .env.local

BASE_URL="http://localhost:3000"

echo "=== Testing YouTube Views API ==="
echo ""

curl -X POST "$BASE_URL/api/youtube-views" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ]
  }'

echo ""
echo ""
echo "=== Testing TikTok Views API ==="
echo ""

curl -X POST "$BASE_URL/api/tiktok-views" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://www.tiktok.com/@example/video/123456"
    ]
  }'

echo ""
echo ""
echo "=== Testing YouTube GET endpoint ==="
echo ""

curl -X GET "$BASE_URL/api/youtube-views"

echo ""
echo "Done!"

