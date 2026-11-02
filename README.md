# NexTerm

NexTerm 是一个面向移动端的 Web SSH 工作区：浏览器登录后，可保存多台开发服务器，使用多标签 xterm.js 终端并行运行 Codex/OpenCode，并通过 SFTP 浏览和传输文件。

## 快速启动（Docker Compose）

```bash
cp .env.example .env
# 编辑 .env：至少设置 32 位以上随机 APP_SECRET
bash scripts/generate-cert.sh your.domain.com
docker compose build

# 仅全新数据卷需要执行一次管理员初始化；密码至少 12 位。
read -rsp "NexTerm admin password: " NEXTERM_BOOTSTRAP_PASSWORD
echo
docker compose run --rm \
  -e NEXTERM_ADMIN_USERNAME=youradmin \
  -e NEXTERM_ADMIN_PASSWORD="$NEXTERM_BOOTSTRAP_PASSWORD" \
  termhub node scripts/create-admin.js
unset NEXTERM_BOOTSTRAP_PASSWORD

docker compose up -d --build
```

已有部署升级到二维码绑定版本时同样执行 `docker compose up -d --build`，然后在浏览器执行一次硬刷新（Ctrl/Cmd+Shift+R）。

默认内网访问地址为 `https://192.168.X.X:3010`。Compose 只绑定 `LAN_BIND_IP`，不再监听 `0.0.0.0`；`192.168.X.0/24` 内网可以直接访问，公网继续使用 `https://your.domain.com/`。证书是针对 `your.domain.com` 生成的，本地使用 IP 访问时浏览器可能提示证书名称不匹配。容器内服务固定监听 3000，宿主机端口由 `HOST_PORT` 控制。

未来域名：`your.domain.com`，完整地址为 `https://your.domain.com`。FRP 等反向代理将公网域名转发到当前服务器的 `HOST_PORT`，并确保 WebSocket (`/ws`) 长连接转发；FRP 可直接透传 HTTPS，也可在 FRP 前置 TLS 终止后转发到该 HTTPS 服务。建议只暴露 HTTPS，不要直接把 SSH 端口映射到公网。

证书文件位于 `certs/`，私钥和证书已加入 `.gitignore`，不会提交到代码仓库。Compose 以非 root 用户运行，并通过只读 root 组权限读取 0640 私钥。迁移到另一台服务器时重新运行 `bash scripts/generate-cert.sh your.domain.com`。

## 管理员初始化

NexTerm 不再创建固定的默认账号或密码。空数据卷未初始化时服务会拒绝启动，必须先运行 `scripts/create-admin.js`。账号信息保存在 Compose 的 `termhub_data` 卷中；服务器密码和私钥使用 AES-256-GCM 加密后保存。可用 `docker volume inspect nexterm_termhub_data` 查找卷路径并纳入备份。

如果升级前的数据仍含有历史上的弱初始密码，服务启动时会阻止该账号登录，并在日志中提示重置命令。请在停止服务或维护窗口执行：

```bash
docker compose run --rm \
  -e NEXTERM_ADMIN_USERNAME=youradmin \
  -e NEXTERM_ADMIN_PASSWORD='新的 12 位以上密码' \
  termhub npm run admin:reset
# 非 Docker 开发模式使用：
# NEXTERM_ADMIN_USERNAME=youradmin NEXTERM_ADMIN_PASSWORD='新的 12 位以上密码' npm run admin:reset
```

重置后重新启动服务，并在登录后立即启用 MFA。重置脚本会清除该管理员的受信任设备和持久化会话；不会修改已保存的服务器配置。

## 开发模式

```bash
npm install
npm run dev
```

前端静态资源位于 `public/`，后端入口为 `server.js`。依赖安装后的 `postinstall` 会把 xterm.js 资源复制到 `public/vendor/`。

## 当前能力

- `HttpOnly + Secure + SameSite=Strict` 服务端会话，默认 12 小时有效；浏览器不保存 Bearer Token
- 修改类 API 使用 CSRF Token；注销、改密码、启停/重绑 MFA 会立即撤销旧会话和 WebSocket
- 登录防护：持久化 IP/账户双维度限流、失败锁定、`Retry-After` 提示；可选 TOTP 双因素认证
- SSH 密码/私钥认证、连接测试、终端窗口 resize、断开/重连
- 多标签会话（每个标签独立 SSH 连接）；手机切后台或网络短暂中断时，服务端会保留 SSH 会话并在回到前台后自动重新挂载
- 移动端 ESC、Tab、Ctrl+C/D、方向键快捷栏
- 终端复制/粘贴：选中文字后右键复制，无选中时右键粘贴；`Ctrl/Cmd+C` 与 `Ctrl+Shift+C` 也会复制选区。Codex 等全屏程序会自行绘制鼠标选区，前端会识别这种选区并请求程序复制，同时接收程序返回的 OSC 52 剪贴板内容
- 头像用户菜单、头像裁剪/缩放、全局界面字体与终端字号设置
- 头像菜单「进化」入口：多行文本框每行提交一条改进建议或 bug 描述，保存在服务端 `data/evolutions.json`；列表按状态显示灰色 •（待处理）、橙色 ✓（AI 已修复、待你确认）、绿色 ✔（已确认闭环）、红色 ✕（未修复/不接受）。已修复的记录需要用户点击「确认已修复」才算闭环，点「仍未修复」会退回待处理
- 服务器侧栏可收起/展开，服务器卡片支持红、橙、黄、绿、青、蓝、紫七种背景色并自动调整文字对比度
- 服务器侧栏的“…”按钮支持鼠标左键长按或触摸长按后拖动排序，顺序会持久化保存
- SFTP 列目录、进入目录、上传、下载、新建目录、删除；上传时显示实时进度并支持取消，支持选择多个文件或整个文件夹上传，文件面板提供关闭按钮
- 2FA 使用标准 OATH-TOTP（SHA-1、6 位、30 秒），可用 FreeOTP、Google Authenticator、1Password 等兼容身份验证器扫描二维码或导入手动密钥/`otpauth://` URI
- 登录时可选择将浏览器设为受信任设备；服务端仅保存随机设备凭证的哈希，默认 30 天内仍需账号密码、但无需重复输入 TOTP，并可在“安全”中撤销全部设备
- Compose 安全基线：非 root 用户、禁止新增 Linux capabilities、`no-new-privileges`
- SSH 主机密钥使用 SHA-256 指纹固定：首次连接采用 TOFU，后续指纹变化会拒绝连接
- 安全事件写入 `audit.log`，安全设置中展示最近登录和 MFA 事件；生产依赖可运行 `npm run security:audit`

### 终端自动审批（大模型）

在「设置 → 自动审批模型（大模型）」中配置一个兼容 OpenAI Chat Completions 协议的模型，可用于 TokenMeter 网关、LM Studio、Ollama、vLLM、OpenAI 等。Base URL 通常以 `/v1` 结尾，本地服务可不填 API Key；密钥使用 `APP_SECRET` 派生的密钥 AES-256-GCM 加密后保存在服务端，不会下发到浏览器（界面只显示末 4 位）。每个账户最多 8 个模型，可分别「测试」验证连通性。

点击终端标签上的闪电图标（或会话栏的「自动审批」按钮）后，服务端会复用已有的无头终端画面来判断 Codex 等 CLI 是否弹出了确认提示，并把画面片段交给模型评估，随后自动按键：

- `approve_once` → 按 1（Yes, proceed）
- `approve_always` → 按 2（Yes, and don't ask again）
- `deny` → 按 3（No, and tell Codex what to do differently）
- `unsafe` / `unknown` → 不按任何键，交回人工处理

判定只看「待确认提示及其要执行的命令」这一段：服务端会从画面里抽出待确认提示和它要执行的命令（命令过长换行也会向上合并），整屏其他命令与历史输出只作为参考，避免模型因为画面里别处出现过 `rm -rf` 就误判。命令名只是触发词，最终按作用对象判定：删除 `/tmp`、`/var/tmp`、`~/.cache`、`dist`/`build`/`node_modules` 等临时或可再生位置属于低风险，直接按 1；只有删除 `/`、`~`、`/home`、`/data`、数据库或备份目录、密钥目录等真实数据，或范围看不清时才交回人工。

安全边界：判定为危险或无法判断时绝不按键；模型报错或返回无法解析时同样交回人工，连续失败会暂停该标签的自动审批；每账户 60 秒内最多 24 次模型调用，避免 TUI 重绘循环无限消耗 token；所有决定与按键都写入 `audit.log`（含待确认命令片段，便于复盘误判）。可用 `APPROVAL_TEST_TIMEOUT_MS`、`APPROVAL_DECISION_TIMEOUT_MS` 调整超时。

后续可继续加入终端主题设置和拖拽上传等增强功能。

### 进化建议与 bug 反馈闭环

点击右上角头像 →「进化」，在多行文本框中每行写一条改进建议或一个 bug 描述（行首可写 `bug：`、`建议：` 显式分类，未标注时按关键词自动判断），提交后每行成为一条独立记录写入 `data/evolutions.json`。单条最长 500 字，单次最多 40 行，每账户最多 300 条、全局最多 2000 条，60 秒内最多提交 6 次。

AI IDE 每次开发或优化本项目时，应先读取这些记录并针对性处理，处理完必须回写状态，界面才会显示结果：

```bash
node scripts/evolution-status.js list                    # 全部记录（含 id）
node scripts/evolution-status.js list --status pending    # 只看待处理
node scripts/evolution-status.js fix <id> --note "已修复滚动监听"
node scripts/evolution-status.js reject <id> --note "与现有设计冲突"
node scripts/evolution-status.js reopen <id>
```

`fix` 会自动写入 `fixedVersion`（取 `public/version.json` 的版本号，可用 `NEXTERM_VERSION` 覆盖），界面显示「修复于 <版本>」。服务端按文件 mtime 重新读取该 JSON，因此脚本回写后浏览器刷新即可看到最新状态，无需重启容器。

闭环需要用户确认：`fix` 只把记录置为 `fixed`（界面显示「待你确认」和「确认已修复 / 仍未修复」两个按钮），用户点击「确认已修复」后记录才变成 `verified`（绿色 ✔，闭环完成，并记录 `verifiedAt`）。点击「仍未修复」把记录退回 `pending` 并清空 `fixedVersion`，下一轮开发会重新处理它；已 `verified` 的记录也可以「重新打开」。对 `verified` 记录再次执行 `fix` 表示问题复现，同样会退回未确认状态。

注意：容器把 `data/` 挂在命名卷 `termhub_data` 里，界面提交的记录写在卷内而不是仓库的 `data/`。在宿主机上直接跑上面的脚本会读到空的 `data/evolutions.json`，回写也不会被容器看到。要处理线上记录，请在容器内执行（`docker compose exec` 会继承服务的环境变量，`DATA_DIR` 因此指向 `/app/data`）：

```bash
docker compose exec termhub node scripts/evolution-status.js list --status pending
docker compose exec termhub node scripts/evolution-status.js fix <id> --note "已修复滚动监听"
```

API：`GET /api/evolutions`、`POST /api/evolutions`（`{ text }`）、`POST /api/evolutions/:id/verify`（`{ action: "confirm" | "reopen" }`）、`DELETE /api/evolutions/:id`，均需登录并遵循现有 CSRF 与审计日志规则。`confirm` 只接受 `fixed` 记录（其他状态返回 409），审计类型为 `evolution.verified` / `evolution.reopened`。

### 移动端后台与 SSH 会话

手机浏览器切换到其它应用后，操作系统可能暂停或回收 WebSocket，浏览器本身无法保证连接永远在线。NexTerm 的 SSH 连接现在与浏览器 WebSocket 解耦：WebSocket 确实断开时，服务器默认保留远程 shell 24 小时；回到浏览器前台、网络恢复或重新登录后，会自动使用同一个会话 ID 重新连接，直接恢复最新终端画面及最近 1000 行滚动历史，然后继续显示实时输出。恢复过程不会逐段播放历史刷新，也不会重新执行命令。页面回到前台不会主动重置仍然健康的 WebSocket。

服务端持续维护终端屏幕快照，旧的 `SSH_OUTPUT_BUFFER_MAX` 和 `SSH_OUTPUT_BUFFER_BYTES` 配置已不再使用。终端恢复回归测试可运行 `npm run test:terminal`。

可在 `.env` 调整保活窗口：

```env
SSH_SESSION_GRACE_MS=86400000   # 24 小时，至少 60000
WS_HEARTBEAT_MS=30000           # WebSocket 心跳，防止 FRP/Nginx 空闲超时
LOGIN_WINDOW_MS=900000         # 登录失败统计窗口：15 分钟
LOGIN_MAX_ATTEMPTS=5           # 同一 IP+用户名失败 5 次后锁定
LOGIN_IP_MAX_ATTEMPTS=30       # 同一 IP 失败 30 次后锁定
LOGIN_ACCOUNT_MAX_ATTEMPTS=12  # 同一账户跨 IP 失败 12 次后锁定
LOGIN_LOCKOUT_MS=900000        # 锁定 15 分钟
SESSION_TTL_SECONDS=43200      # 登录会话绝对有效期：12 小时
PASSWORD_MIN_LENGTH=12         # 新密码和初始化密码最少长度
TRUSTED_DEVICE_TTL_SECONDS=2592000 # 受信任设备有效期：30 天
```

## 公网网关

应用自身已输出 HSTS、CSP、防嵌入、nosniff、Referrer-Policy 等安全响应头。公网 Nginx 还应启用第二层登录限速并隐藏版本号，模板见 `deploy/nginx/nexterm-security.conf.example`。对 SSH 管理入口，建议在公网域名前继续增加 Cloudflare Access、Tailscale/VPN 或明确的 IP 白名单；该步骤需要外部网关账户和配置权限。

完整实施状态和验收标准见 `roadmap.md`。

注意：如果服务器进程、容器或主机重启，内存中的 SSH 会话仍会丢失；需要更强的持久性时，应在目标主机使用 `tmux`/`screen`，例如先在终端中运行 `tmux new -A -s codex`。这样即使 SSH 会话真正断开，重新连接后也能恢复 Codex/OpenCode 工作现场。
