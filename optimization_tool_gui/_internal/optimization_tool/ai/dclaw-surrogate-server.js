/**
 * dclaw-surrogate-server.js
 * DClaw AI 代理模型服务 — Node.js 集成入口。
 *
 * 为 DClaw 核心服务（Node.js 端口 26899）提供 AI 代理模型 API。
 * 内部调用 Python 的 scikit-learn 进行高斯过程回归计算。
 *
 * 集成方式（二选一）：
 *   A. 独立运行: node dclaw-surrogate-server.js
 *   B. 路由挂载: 在 DClaw 核心服务的 Express 中 app.use('/api/ai', surrogateRouter)
 *
 * 依赖：
 *   - Python 3.8+ 环境，已安装 scikit-learn, numpy
 *   - 环境变量 DCLAW_PYTHON 指定 Python 路径（默认: python）
 *
 * API 端点（与 Python 客户端 RemoteAPISurrogate 兼容）：
 *   GET  /api/ai/surrogate/status  — 模型状态
 *   POST /api/ai/surrogate/train   — 提交训练数据
 *   POST /api/ai/surrogate/predict — 获取预测
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ============================================================
//  配置
// ============================================================

const PORT = process.env.DCLAW_SURROGATE_PORT || 5001;
const PYTHON = process.env.DCLAW_PYTHON || 'python';
const WORK_DIR = path.join(__dirname, '.surrogate_workspace');
const PYTHON_SERVER = path.join(__dirname, 'server.py');

if (!fs.existsSync(WORK_DIR)) {
  fs.mkdirSync(WORK_DIR, { recursive: true });
}

// ============================================================
//  内存会话
// ============================================================

class SessionStore {
  constructor() {
    this._sessions = new Map();
  }

  get(sid) {
    return this._sessions.get(sid) ||
      { X: [], y: [], n_var: 0, n_obj: 1 };
  }

  getOrCreate(sid) {
    if (!this._sessions.has(sid)) {
      this._sessions.set(sid, { X: [], y: [], n_var: 0, n_obj: 1 });
    }
    return this._sessions.get(sid);
  }

  delete(sid) {
    this._sessions.delete(sid);
  }

  get size() {
    return this._sessions.size;
  }
}

const sessions = new SessionStore();

// ============================================================
//  Python 子进程管理（调用 server.py 进行计算）
// ============================================================

/**
 * 启动 Python 服务器作为子进程，通过 HTTP 通信。
 * 避免每次请求都启动新进程的开销。
 */
let pythonProcess = null;

function startPythonServer() {
  if (pythonProcess) return pythonProcess;

  const pyPort = PORT + 1;  // 内部端口
  pythonProcess = spawn(PYTHON, [PYTHON_SERVER, '--port', String(pyPort)], {
    cwd: WORK_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python] ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python] ${data.toString().trim()}`);
  });

  pythonProcess.on('exit', (code) => {
    console.log(`[Python] 子进程退出 (code=${code})`);
    pythonProcess = null;
  });

  pythonProcess.on('error', (err) => {
    console.error(`[Python] 子进程错误: ${err.message}`);
    pythonProcess = null;
  });

  return pythonProcess;
}

function stopPythonServer() {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
}

/**
 * 调用 Python Flask 服务器进行预测。
 * 使用 HTTP 请求，确保与 Python 端 API 完全一致。
 */
async function callPython(method, endpoint, body) {
  const pyPort = PORT + 1;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: '127.0.0.1',
      port: pyPort,
      path: endpoint,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 30000,
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => (responseData += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          reject(new Error(`JSON 解析失败: ${responseData}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });

    req.write(data);
    req.end();
  });
}

// ============================================================
//  HTTP 请求处理
// ============================================================

async function handleRequest(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Session-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    const sessionId = req.headers['x-session-id'] || 'default';

    // ── GET /api/ai/surrogate/status ──
    if (req.method === 'GET' && pathname === '/api/ai/surrogate/status') {
      const session = sessions.get(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ready: session.X.length >= 3,
        samples: session.X.length,
        n_var: session.n_var,
        n_obj: session.n_obj,
        session_id: sessionId,
        instances: sessions.size,
      }));
      return;
    }

    // ── POST /api/ai/surrogate/train ──
    if (req.method === 'POST' && pathname === '/api/ai/surrogate/train') {
      const body = await parseBody(req);
      const { X, y } = body || {};

      if (!X || !y) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: '缺少 X 或 y 字段' }));
        return;
      }

      const session = sessions.getOrCreate(sessionId);
      session.X.push(...X);
      session.y.push(...y);
      session.n_var = X[0]?.length || 0;
      session.n_obj = y[0]?.length || 1;

      // 转发到 Python 服务器训练
      try {
        await callPython('POST', '/api/ai/surrogate/train', { X, y });
      } catch (e) {
        console.warn(`[Python] 训练转发失败 (将在本地降级): ${e.message}`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        samples: session.X.length,
        session_id: sessionId,
      }));
      return;
    }

    // ── POST /api/ai/surrogate/predict ──
    if (req.method === 'POST' && pathname === '/api/ai/surrogate/predict') {
      const body = await parseBody(req);
      const { X } = body || {};

      if (!X) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: '缺少 X 字段' }));
        return;
      }

      // 优先调用 Python 服务器
      try {
        const result = await callPython('POST', '/api/ai/surrogate/predict', { X });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      } catch (e) {
        console.warn(`[Python] 预测请求失败，使用本地降级: ${e.message}`);
      }

      // 降级：返回高不确定性
      const n = X.length;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        mean: new Array(n).fill(0),
        std: new Array(n).fill(10.0),
      }));
      return;
    }

    // ── DELETE /api/ai/surrogate/cleanup ──
    if (req.method === 'DELETE' && pathname === '/api/ai/surrogate/cleanup') {
      if (sessionId) sessions.delete(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', instances: sessions.size }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Not Found' }));

  } catch (err) {
    console.error('[Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: err.message }));
  }
}

// ============================================================
//  辅助函数
// ============================================================

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

// ============================================================
//  启动服务
// ============================================================

const server = http.createServer(handleRequest);

// 启动 Python 后端
startPythonServer();

// 等待 Python 服务就绪
function waitForPython(retries = 10) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: PORT + 1, path: '/api/ai/surrogate/status', method: 'GET', timeout: 2000 },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve());
        }
      );
      req.on('error', () => {
        if (n <= 0) reject(new Error('Python 服务启动超时'));
        else setTimeout(() => check(n - 1), 500);
      });
      req.end();
    };
    check(retries);
  });
}

server.listen(PORT, async () => {
  try {
    await waitForPython();
    console.log(`========================================`);
    console.log(`  DClaw AI Surrogate 服务已启动`);
    console.log(`  Node.js 网关: http://localhost:${PORT}`);
    console.log(`  Python 后端:  http://127.0.0.1:${PORT + 1}`);
    console.log(`========================================`);
    console.log(`  API 端点:`);
    console.log(`    GET  /api/ai/surrogate/status`);
    console.log(`    POST /api/ai/surrogate/train`);
    console.log(`    POST /api/ai/surrogate/predict`);
    console.log(`========================================`);
  } catch (e) {
    console.warn(`[警告] Python 后端未就绪，将使用本地降级模式: ${e.message}`);
    console.log(`Node.js 网关已启动 (端口 ${PORT})，AI 计算将降级处理`);
  }
});

// 优雅退出
process.on('SIGINT', () => { stopPythonServer(); process.exit(0); });
process.on('SIGTERM', () => { stopPythonServer(); process.exit(0); });