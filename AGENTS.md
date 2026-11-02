【强制工具使用策略】
0. **所有面向用户的反馈（包括回复、说明、提问、commit 说明、`--note` 备注等）一律使用简体中文**
1. 理解代码结构、查找函数调用链、分析模块依赖时，**必须优先使用 codegraph_explore / codegraph_search / codegraph_callers / codegraph_impact**
2. 禁止直接用 grep / glob / Read 盲目扫文件，先用 CodeGraph 缩小范围再读取具体文件
3. 如果 CodeGraph 返回的信息不足，再辅以其他文件工具

【发布与容器操作】
4. 修改代码后不要主动执行 `docker compose build`、`docker compose up`、重启容器或其他部署操作；等待用户明确要求，或由用户自行执行 `scripts/release.sh`。
5. 需要用户手动发布时，使用项目根目录的 `./scripts/release.sh`。该脚本会按本地时间更新版本号、构建并重建 `termhub` 容器，然后检查 `/api/health` 返回的运行版本。

【代码提交与推送】
5.5 每完成一个任务（通过语法检查、diff 自查无误）后，**必须直接**执行：
   - `git add -A`（或只 `git add` 本次实际改动的文件）
   - `git commit -m "中文提交说明：改了什么、在哪改的"`（提交说明一律用简体中文）
   - `git push origin main`
   仓库已配置到 Gitea 的免密推送（SSH key），无需再让用户确认即可直接 `git push origin main`。若当前分支不是 `main`，则推送到当前分支 `git push origin HEAD`。

【进化建议与 bug 反馈闭环】
6. 每次开始开发或优化本项目前，**必须先读取待处理的进化记录**，据此安排本轮的修复或优化：
   ```bash
   docker compose exec termhub node scripts/evolution-status.js list --status pending
   ```
   记录由用户在界面「头像 → 进化」提交，存在容器卷 `termhub_data` 的 `/app/data/evolutions.json`。
   **不要直接读仓库里的 `data/evolutions.json`** —— 那个文件不存在或为空，宿主机上直接跑脚本会看到 "No evolution records"，回写也不会被界面看到。
   必须在容器内执行（`docker compose exec` 继承服务环境变量，`DATA_DIR` 指向 `/app/data`）。
7. 每条记录的处理流程（四步，缺一不可）：
   a. `list --status pending` 取到 `id` 和原文；需要完整字段用 `show <id>`。
   b. 在代码里定位并**真正修复**问题；无法修复或不接受时准备一句中文理由。
   c. 代码修复完成（通过语法检查、diff 自查无误）后**直接回写**，不用等 `./scripts/release.sh` 发布上线（用户确认前会自行发布）：
      - 已修好：`docker compose exec termhub node scripts/evolution-status.js fix <id> --note "改了什么、在哪改的"`
      - 不接受/无法复现：`... reject <id> --note "原因"`
   d. 回写后 `list` 复查该条状态已变，才算完成。`--note` 会显示在界面上，写清楚改动点。
8. 状态与界面显示（闭环由**用户**确认，AI 只能声明）：
   - `pending` 灰色 • 待处理 —— AI 未回写，界面上看不到结果
   - `fixed` 橙色 ✓「待你确认」+「确认已修复 / 仍未修复」按钮 —— AI 已回写 `fix`，**尚未闭环**
   - `verified` 绿色 ✔「已确认闭环」—— 用户点了「确认已修复」，记录写入 `verifiedAt`，这才是闭环
   - `rejected` 红色 ✕「未修复 / 不接受」
   用户点「仍未修复」或「重新打开」会把记录退回 `pending` 并清空 `fixedVersion`，下一轮必须重新处理；对 `verified` 记录再次 `fix` 表示问题复现，同样退回未确认。
9. 只有 `scripts/evolution-status.js` 和界面按钮可以改这个库；**不要手改 `evolutions.json`**（服务端按 mtime 重载，手改容易和脚本或界面并发写冲突）。服务端 API：`GET /api/evolutions`、`POST /api/evolutions`、`POST /api/evolutions/:id/verify`（`{action:"confirm"|"reopen"}`）、`DELETE /api/evolutions/:id`。
