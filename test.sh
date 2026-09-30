#!/bin/bash
curl -s -X POST https://screenshot-upload-mcp-server.adam-efc.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: myMakeServer2026!" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'
echo
echo "---"
curl -s -X POST https://screenshot-upload-mcp-server.adam-efc.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer myMakeServer2026!" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'
echo
