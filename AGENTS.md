# AGENTS.md

面向 AI 助手在本仓库工作的强制约定。分为：工具策略、发布、提交、进化闭环四部分。

## 一、语言与工具策略

1. **所有面向用户的反馈一律使用简体中文**：包括回复、说明、提问、`git commit` 说明、进化记录的 `--note` 备注等。
2. 理解代码结构、查找函数调用链、分析模块依赖时，**优先使用 CodeGraph 工具**：`codegraph_explore` / `codegraph_search` / `codegraph_callers` / `codegraph_impact`。
3. **禁止**直接用 `grep` / `glob` / `Read` 盲目扫文件；先用 CodeGraph 缩小范围，再读取具体文件。
4. CodeGraph 返回信息不足时，再辅以 `rg`、文件读取等常规工具。

## 二、发布与容器操作

5. 修改代码后**不要主动**执行 `docker compose build` / `docker compose up`、重启容器或其他部署操作；等待用户明确要求。
6. 需要发布时由用户自行运行项目根目录的 `./scripts/release.sh`：脚本会按本地时间更新版本号、构建并重建 `termhub` 容器，随后检查 `/api/health` 返回的运行版本。

## 三、代码提交与推送

7. 每完成一个任务（通过语法检查、diff 自查无误）后，**直接**执行：
   ```bash
   git add -A            # 或只 add 本次实际改动的文件
   git commit -m "中文说明：改了什么、在哪改的"
   git push origin main
   ```
   - `origin` 已配置为 GitHub 仓库（`git@github.com:hzh19881209/NexTerm.git`），免密推送，无需再次向用户确认即可 `git push`。
   - 提交说明一律用简体中文，写清楚「改了什么、在哪改的」。
   - 若当前分支不是 `main`，则推送到当前分支：`git push origin HEAD`。
   - 本目录**只服务 GitHub**，不要再推送或关联其他私有仓库。

## 四、进化建议与 bug 反馈闭环

进化记录由用户在界面「头像 → 进化」提交，存于容器卷 `termhub_data` 的 `/app/data/evolutions.json`。

8. **每次开始开发/优化前，必须先读取待处理记录**，据此安排本轮修复：
   ```bash
   docker compose exec termhub node scripts/evolution-status.js list --status pending
   ```
   - 必须在容器内执行（`docker compose exec` 继承服务环境变量，`DATA_DIR` 指向 `/app/data`）。
   - **不要直接读仓库里的 `data/evolutions.json`**：该文件不存在或为空，宿主机上直接跑会显示 "No evolution records"，回写也不会被界面看到。

9. **每条记录四步处理，缺一不可**：
   1. `list --status pending` 取到 `id` 和原文；需要完整字段用 `show <id>`。
   2. 在代码里定位并**真正修复**问题；无法修复或不接受时准备一句中文理由。
   3. 代码修复完成（通过语法检查、diff 自查无误）后**直接回写**，无需等 `./scripts/release.sh` 上线（用户会自行发布）：
      - 已修好：`docker compose exec termhub node scripts/evolution-status.js fix <id> --note "改了什么、在哪改的"`
      - 不接受 / 无法复现：`docker compose exec termhub node scripts/evolution-status.js reject <id> --note "原因"`
   4. 回写后再 `list` 复查该条状态已变更，才算完成。`--note` 会显示在界面上，写清楚改动点。

10. **状态与界面显示**（闭环由**用户**确认，AI 只能声明）：

    | 状态 | 界面 | 含义 |
    |------|------|------|
    | `pending` | 灰色 • 待处理 | AI 未回写，界面看不到结果 |
    | `fixed` | 橙色 ✓ 待你确认 | AI 已回写 `fix`，**尚未闭环**，可点「确认已修复 / 仍未修复」 |
    | `verified` | 绿色 ✔ 已确认闭环 | 用户点了「确认已修复」，写入 `verifiedAt`，**这才是闭环** |
    | `rejected` | 红色 ✕ 未修复/不接受 | AI 回写 `reject` |

    用户点「仍未修复」或「重新打开」会把记录退回 `pending` 并清空 `fixedVersion`，下一轮必须重新处理；对 `verified` 记录再次 `fix` 表示问题复现，同样退回未确认。

11. **只能**通过 `scripts/evolution-status.js` 或界面按钮修改该库；**不要手改 `evolutions.json`**（服务端按 mtime 重载，手改易与脚本/界面并发写冲突）。相关服务端 API：
    - `GET /api/evolutions`
    - `POST /api/evolutions`
    - `POST /api/evolutions/:id/verify`（`{action:"confirm"|"reopen"}`）
    - `DELETE /api/evolutions/:id`
