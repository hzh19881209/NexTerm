# NexTerm 安全加固路线图

本路线图面向公网暴露的 Web SSH/SFTP 场景。验收目标不是“绝对不会被攻击”，而是消除已识别的无密码会话接管路径、缩小暴露面，并让关键安全事件可撤销、可追踪。

## 0. 【最高优先级】Windows 远程桌面支持（方案 B：Node VNC 桥 + noVNC）

- 状态：核心实现已完成（浏览器 noVNC ↔ Node VNC 桥 ↔ Windows:5900 已打通，支持断线重连、审计 `vnc.connect`/`vnc.disconnect`）；Windows 端 VNC 服务（UltraVNC/TightVNC/内置组件）随包打包待完成
- 优先级：最高（先于其余路线图中所有未完成项）
- 目标：支持 Windows 10 / 11 / Windows Server 的图形远程桌面（RDP/VNC 形式，非 SSH），浏览器内直接操作桌面。
- 方案选型结论：不走 RDP 原生（`@microsoft/rdp-server` 仅支持客户端方向，无官方 Web RDP 客户端，协议与图形子系统复杂度过高）；采用业界通行做法（Apache Guacamole、MeshCentral、RustDesk 同源思路）的 VNC 链路。

### 实施内容

1. Windows 端：轻量 VNC 服务（小型 .exe，Windows 服务方式运行，约 10MB）
   - Windows Server 2019+ 使用内置 VNC 组件（PowerShell 安装）；更早版本用 UltraVNC 或随包 .exe。
   - 提供 VNC Server（5900）+ 管理接口（开关、改密码、状态）；身份校验由 NexTerm 桥完成，VNC 侧可用 SSL 隧道或 RFB + 无认证 + IP 白名单，避免明文认证暴露。
2. NexTerm 服务端：VNC 桥模式
   - 服务器模型增加 `protocol: 'ssh' | 'vnc'`（默认 ssh，向后兼容现有数据）。
   - 新增 `createVncSession()`：浏览器 WebSocket ↔ Node（RFB 协议实现，或 `vnc-client` 包）↔ Windows:5900。
   - 复用现有能力：会话 detach/reattach、空闲超时（`SSH_SESSION_GRACE_MS` 同思路）、`encrypt/decrypt`（AES-256-GCM，server.js:231）存储 VNC 密码、`auditEvent` 审计。
3. 前端
   - 服务器卡片/标签增加“VNC 桌面”入口，点击打开 canvas 渲染的新标签（非 xterm）。
   - 引入 noVNC（MIT 协议，Guacamole 底层库，单文件约 200KB，零依赖），本地 vendor 至 `public/vendor/`（与 xterm.js 一致）。
   - `server.os === 'windows'` 默认显示桌面模式；其他系统可手动切换 VNC。
4. 安全
   - VNC 流量仅在 NexTerm ↔ Windows 间走内网；浏览器 ↔ NexTerm 沿用现有 HTTPS。
   - 审计事件：`vnc.connect` / `vnc.disconnect`，对齐现有 `auditEvent`。

### 验收

- Windows 服务器以 `protocol: 'vnc'` 配置后，浏览器内可完成登录并操作桌面，支持断线重连。
- 现有 SSH 服务器行为零变化（`protocol` 缺省即 ssh）。
- 审计日志可查 VNC 连接/断开事件；VNC 密码不以明文出现在 `servers.json`、日志或 URL 中。
- 数据迁移：存量服务器自动补 `protocol: 'ssh'`，无需用户操作。

### Windows 主机文件传输（SFTP 桥）

- 状态：已完成（代码已提交，随 `scripts/release.sh` 发布生效）
- 背景：Windows 主机没有内置 SSH/SFTP 服务，VNC 桌面之外还希望在网页里管理 Windows 文件。
- 方案：Windows 端运行任意 SFTP 服务（Win32-OpenSSH 的 `sftp-server.exe`、FileZilla Server、WinSCP 等）监听一个 LAN 端口；NexTerm 用已有的 `ssh2-sftp-client` 作为**客户端**连过去，并复用现有 `/api/servers/:id/files` 接口。浏览器侧的 SFTP 面板与 Linux/SSH 完全一致（列表/上传/下载/新建目录/重命名/删除）。
- 实现要点：
  - 服务器模型新增 `sftpBridgeEnabled/Port/Root/User/Auth/PrivateKey/Passphrase/Password` + `sftpFingerprint`（TOFU 主机指纹，端点变化自动清空），密码/私钥经 `encrypt/decrypt` 存储。
  - `withSftp()` 对 `os==='windows' && sftpBridgeEnabled` 的服务器走 Windows SFTP 客户端，其余仍走 `sshConfig`。用 Proxy 把浏览器侧以 Windows 根目录为 `/` 的路径翻译成 Windows 绝对路径（正斜杠→反斜杠）。
  - 前端把 SFTP 面板 markup/wiring 抽成 `sftpPanelMarkup()` / `wireSftpPanel()`，VNC 标签与 SSH 标签共用；VNC 标签点 SFTP 时若视图已存在则跳过 VNC 握手，直接走 REST。
  - Windows SFTP 服务不支持递归 `RMDIR`，删除前用 `stat` 判断文件/目录，目录走非递归 `rmdir`。
- 验收：
  - Windows 服务器启用 SFTP 桥并配置端口/根目录/凭据后，标签页里能打开与 Linux 相同的 SFTP 面板，完成列目录、上传、下载、新建目录、重命名、删除。
  - 现有 SSH 服务器与未启用桥的 Windows 服务器行为零变化。
  - SFTP 凭据不以明文出现在 `servers.json`、日志或 URL 中；首次连接固定主机指纹（TOFU），指纹变化拒绝连接。

### 工作量估计

- 核心桥 + noVNC 集成：约 2-3 天；Windows VNC 服务打包/内置组件接入：约 1 天；测试（NLA、高 DPI、剪贴板）：约 1-2 天。
- 备选（更重，留作未来储备）：Docker 内置 Apache Guacamole 后端（Java 栈，RDP+VNC 全支持），仅在确需 RDP 原生能力（声音、驱动器映射）时启用。

## 1. 禁止在 URL 中传递登录令牌

- 状态：已完成
- 实施：浏览器改用 `HttpOnly + Secure + SameSite=Strict` 会话 Cookie；WebSocket 只访问 `/ws`；SFTP 下载使用同源 Cookie，不再拼接 `token` 查询参数。
- 验收：源码及公网访问日志中不再出现 `/ws?token=` 或下载 URL 中的 `token=`。

## 2. 服务端会话、主动注销与全量撤销

- 状态：已完成
- 实施：新增持久化服务端会话；Cookie 中只保存高熵随机凭证，磁盘仅保存哈希；注销、修改密码、启停/重绑 MFA 时撤销会话并关闭对应 WebSocket/SSH 会话。
- 验收：旧 Cookie 在注销或安全设置变化后立即返回 401，不能继续访问 API 或 WebSocket。

## 3. 缩短会话寿命并增加 CSRF 防护

- 状态：已完成
- 实施：会话绝对有效期默认 12 小时；所有修改类请求要求同源 CSRF Token；WebSocket 校验 `Origin` 与 `Host` 一致。
- 验收：缺少或错误 CSRF Token 的 POST/PUT/DELETE 请求返回 403；跨站 WebSocket 握手被拒绝。

## 4. 移除固定默认账户

- 状态：已完成
- 实施：不再自动创建 `youradmin / 123456`；空数据卷必须先运行管理员初始化脚本，并使用至少 12 位密码。
- 验收：空数据卷且未初始化时服务拒绝启动，不产生可预测账户。

## 5. MFA 重绑定保护

- 状态：已完成
- 实施：首次启用 MFA 需要当前密码；已经启用 MFA 时，重新生成密钥必须同时验证当前密码和旧验证码；启停/重绑后撤销旧会话。
- 验收：仅持有旧会话但不知道密码和旧验证码时，无法替换验证器。

## 6. 限制后端端口到内网网段

- 状态：已完成
- 实施：按用户要求不绑定 `127.0.0.1`，Compose 仅绑定宿主机内网地址 `192.168.X.X`；允许 `192.168.X.0/24` 内网访问，公网继续通过 HTTPS 反向代理入口访问。
- 验收：宿主机不再监听 `0.0.0.0:3010`；局域网地址可访问；公网不能直接访问 `:3010`。

## 7. 安全响应头与双层登录限速

- 状态：已完成
- 实施：应用统一输出 HSTS、CSP、防嵌入、nosniff、Referrer-Policy 和 Permissions-Policy；登录锁定状态持久化并增加全账户维度；公网 Nginx 已隐藏版本号并启用独立 `limit_req` 登录限速。
- 验收：公网响应包含安全头；进程重启后锁定仍有效；分布式 IP 尝试仍受账户级限制。

## 8. 第二访问边界

- 状态：内网边界已完成；公网第二身份边界需外部网关配置
- 实施：直接后端访问限制在 `192.168.X.0/24`；提供公网 Nginx/Cloudflare Access/Tailscale 接入建议和配置模板。
- 验收：公网域名在到达 NexTerm 登录页前，再经过 IP 白名单、VPN 或身份访问代理中的至少一种。
- 说明：Cloudflare Access、Tailscale 等需要用户选择供应商并提供外部账户/网关权限，不能仅在本仓库内自动启用。

## 9. SSH 主机指纹、审计与依赖维护

- 状态：已完成
- 实施：首次连接采用 TOFU 固定 SSH 主机 SHA-256 指纹，后续变化立即拒绝；记录登录、注销、密码/MFA、服务器配置和主机指纹事件；提供生产依赖审计命令。
- 验收：目标 SSH 主机密钥变化时连接失败；审计日志不记录密码、TOTP、Cookie、私钥或会话凭证；`npm run security:audit` 可执行。

## 发布检查

- 未登录 API 与 WebSocket 均被拒绝。
- Cookie 包含 `HttpOnly; Secure; SameSite=Strict`。
- 不在 URL、浏览器本地存储或日志中保存认证令牌。
- 修改密码、MFA 或注销后旧会话立即失效。
- `node --check`、`npm audit --omit=dev`、Docker 健康检查通过。
