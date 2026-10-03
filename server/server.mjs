#!/usr/bin/env node
// 사용: node server/server.mjs [--port 8080] [--data ./data] [--static ./dist] [--token 비밀값] [--cors]
import { createApp } from './app.mjs';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? (process.argv[i + 1] ?? true) : def; };
const port = Number(arg('port', process.env.PORT || 8080));
const dataDir = String(arg('data', process.env.DATA_DIR || './data'));
const staticDir = String(arg('static', process.env.STATIC_DIR || './dist'));
const token = String(arg('token', process.env.QR_TOKEN || ''));
const cors = process.argv.includes('--cors');

createApp({ dataDir, staticDir, token, cors }).listen(port, () => {
  console.log(`검토 서버 실행: http://localhost:${port}  (데이터 ${dataDir}, 화면 ${staticDir}${token ? ', 접근 토큰 사용' : ''})`);
});
