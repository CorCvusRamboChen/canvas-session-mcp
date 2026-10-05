# canvas-session-mcp

**Connect Claude, Cursor, Codex and other AI assistants to Canvas LMS — no access token needed.**
**不用 Access Token，一条命令让 Claude / Cursor / Codex 等 AI 读你的 Canvas。**

[English](#english) · [中文](#中文) · [Website / 网页](https://corcvusrambochen.github.io/canvas-session-mcp/)

---

## English

Most Canvas integrations ask you to create a personal **access token**, and many universities no longer let students do that. This MCP server does what the Canvas website itself does: it uses **your normal login**. Sign in once in a real Chrome/Edge window (SSO and MFA as usual), and your AI assistant can read your courses.

- **No token, no admin approval.** If you can open Canvas in a browser, this works.
- **Read-only.** It only ever sends `GET` requests: it cannot submit, post or change anything.
- **Local.** Your login and files stay on your computer. Nothing goes anywhere except your school's Canvas.
- **Reads and saves course files.** Slides, assignment PDFs and Word documents come back as text, and whole courses can be saved into a folder you choose.

### One-step setup

You need [Node.js 20+](https://nodejs.org) and Chrome or Edge. Then run:

```bash
npx -y https://github.com/CorCvusRamboChen/canvas-session-mcp/archive/refs/heads/main.tar.gz setup
```

Setup asks for three things, then does the rest:

1. **Your Canvas address**, e.g. `https://canvas.lms.unimelb.edu.au`.
2. **Where to save course files.** The default is `Documents/Canvas`; any folder works.
3. **Sign in** in the browser window that opens. It closes by itself.

It then finds the AI apps on your computer — **Claude Desktop, Claude Code, Cursor, Windsurf, Codex** — and asks before connecting each one. Existing settings are kept, and a backup of every file it changes is saved next to it (`*.before-canvas-mcp.bak`). Restart the app and ask: *"What's due this week on Canvas?"*

### What people actually ask

These are real requests from one student's semester (course codes and IDs changed).

| Ask | What happened |
|---|---|
| *"Give me the Assignment 3 questions."* | The PDF had been uploaded as **`Assing3-26.pdf`** (a typo) and only attached to an announcement, while the Files tab was hidden. The AI found it among the announcement attachments and read the questions out. |
| *"What's due this week, and have I submitted?"* | Listed Assignment 4 (Sunday, **not submitted**), a weekly quiz and an assessed quiz. Timetabled classes are left out so real deadlines aren't buried. |
| *"Download everything for Linear Algebra."* | Found 12 files spread across modules, announcements and assignment pages, saved 8 unique PDFs (questions *and* solutions) into `Canvas/MATH1012/…`, and skipped uploads that were byte-for-byte duplicates. Running it again took 2 s and only fetched new files. |
| *"I had an extension — what's still outstanding?"* | `canvas_upcoming` with `past_days` shows overdue and missing work next to what's coming up. |
| *"Pull together every marking criterion for my lab report."* | Assignment instructions, the rubric (when the course uses Canvas rubrics) and the linked brief and sample-essay PDFs, read in one go. |
| *"Check my SQL against the assignment spec."* | The spec PDF is read as text, so the AI can check column order, banned keywords and formatting rules line by line. |

### Tools

| Tool | What it does |
|---|---|
| `canvas_upcoming` | Everything due soon across all courses, with submission status (`past_days` for overdue work) |
| `canvas_list_courses` | Your courses; this term's are marked `current_term` |
| `canvas_list_assignments` / `canvas_get_assignment` | Assignments, full instructions, rubric, your submission and score |
| `canvas_list_announcements` | Recent announcements as text, with attached files |
| `canvas_list_modules` / `canvas_get_page` | Course structure and pages |
| `canvas_list_files` / `canvas_read_file` | Find and read files (PDF, DOCX, HTML, text). When the Files tab is hidden, files are gathered from modules, announcements and assignments |
| `canvas_save_course_files` | Save a whole course into your folder: `<course>/<module or source>/…`, unchanged files skipped, duplicates kept once |
| `canvas_list_discussions` / `canvas_get_discussion` | Discussion topics and replies |
| `canvas_grades` | Course grades, scores and teacher comments |
| `canvas_inbox` | Canvas Inbox conversations |
| `canvas_calendar` | Calendar events: classes, exams, consultations |
| `canvas_api_get` | Any other Canvas REST endpoint (GET only) |
| `canvas_whoami` | Check the connection |

### Staying signed in

Canvas and most school SSOs use *session* cookies that a browser forgets when it closes, so the server keeps them in your data folder and renews them when needed. Measured on a real university Canvas (Okta SSO behind a Cloudflare bot check):

| Situation | What happens | Measured |
|---|---|---|
| Normal use | Saved cookies are sent straight to Canvas; no browser starts | 0.7 s |
| Canvas session expired, SSO still remembers you | A sign-in window opens at your school's SSO, completes **without typing anything**, and closes | 9.9 s |
| SSO session expired too (e.g. computer off for days) | The window stays open for you to sign in, as in any browser | — |
| Hidden (headless) renewal | Works where SSO bounces straight back. At this university a Cloudflare bot check stops it, so the server switches to the visible window and remembers that. **Bot checks are never automated or bypassed.** | — |

Prefer no pop-ups? Set `CANVAS_MCP_RENEW=hidden` and run `login` yourself when `status` reports an expired session.

### How it was verified

- **17 automated tests** run against a fake Canvas server and through a real MCP client: pagination, cookie refresh, hidden-Files fallback, duplicate uploads, setup writing each app's config, and a check that only `GET` requests are ever sent.
- **60/60 live checks** on a real account through a real MCP client (`node scripts/verify-live.mjs`): 13 courses; modules, files, assignments and pages in each; announcements, grades, inbox, calendar, upcoming work, and a lecture PDF read as text.
- **Session expiry simulated** by deleting the Canvas session and SSO session cookies separately, with results as in the table above.
- **Setup tested** against a throwaway home folder: Claude Desktop, Codex and Cursor configs written correctly, existing servers kept, backups made.

Problems found and fixed during live testing:
- Assignment PDFs attached to announcements were missed.
- Last semester's courses were counted as current.
- Timetable events crowded out real deadlines.
- Identical files uploaded twice were saved twice.

### Manual configuration

If you'd rather not run `setup`, point any MCP client at the server:

```json
{ "mcpServers": { "canvas": { "command": "npx", "args": ["-y", "https://github.com/CorCvusRamboChen/canvas-session-mcp/archive/refs/heads/main.tar.gz"] } } }
```

On Windows, use `"command": "cmd", "args": ["/c", "npx", "-y", "…"]`. Then run `… login --url https://your-canvas` once.

| Command | |
|---|---|
| `setup` | Everything above |
| `login` | Sign in again |
| `status` | Is the login still valid, and where do files go? |

| Variable | Meaning |
|---|---|
| `CANVAS_URL` | Canvas address (overrides the saved one) |
| `CANVAS_MCP_DOWNLOADS` | Folder for course files (overrides the saved one) |
| `CANVAS_MCP_HOME` | Data folder (default `~/.canvas-session-mcp`) |
| `CANVAS_MCP_RENEW` | `hidden` = never open a sign-in window |
| `CANVAS_MCP_BROWSER` | `chrome`, `msedge` or `chromium` |

### Privacy and responsible use

Your session cookies are stored in `~/.canvas-session-mcp/session.json`, readable only by your user account. Treat that file like a password, and delete the folder to sign out. This is an unofficial tool, not affiliated with or endorsed by Instructure. It reads only what you can already see in your own browser, at a normal pace. Check your institution's IT acceptable-use policy, keep course materials private, and follow your subjects' rules on AI use.

---

## 中文

现有的 Canvas 工具大多要你生成个人 **Access Token**，但很多大学已经不让学生自己生成了。这个 MCP 服务器的做法和 Canvas 网页版本身一样：用**你正常登录后的会话**。在真实的 Chrome/Edge 窗口里登录一次（学校 SSO、MFA 照常），之后 AI 就能读你的课程。

- **不用 token，不用管理员批准**：浏览器能打开 Canvas 就能用。
- **只读**：只发 `GET` 请求，不会提交、发帖或修改任何东西。
- **数据只在本地**：登录状态和下载的文件都留在你自己的电脑上，除了访问学校的 Canvas，不发往任何地方。
- **能读也能存课件**：讲义、作业 PDF、Word 都能转成文字给 AI，也能把整门课的文件下载到你选的文件夹。

### 一键安装

先装好 [Node.js 20+](https://nodejs.org) 和 Chrome 或 Edge，然后运行：

```bash
npx -y https://github.com/CorCvusRamboChen/canvas-session-mcp/archive/refs/heads/main.tar.gz setup
```

setup 会问三件事，剩下的它自己完成：

1. **Canvas 地址**，比如 `https://canvas.lms.unimelb.edu.au`
2. **课件存到哪里**：默认 `文档/Canvas`，可以换成任何文件夹
3. **登录**：在弹出的浏览器窗口里登录，完成后窗口自动关闭

然后它会找到你电脑上的 AI 应用（**Claude Desktop、Claude Code、Cursor、Windsurf、Codex**），每个都先问你，同意了才接入。原有配置会保留，改动的每个文件旁边都会留一份备份（`*.before-canvas-mcp.bak`）。重启 AI 应用后问一句：“Canvas 上这周有什么要交？”

### 真实用例

下面都是一个学生这学期真实问过的问题（课程代码和 id 已替换）。

| 问 | 结果 |
|---|---|
| “把 Assignment 3 的题目给我” | 老师把文件名拼成了 **`Assing3-26.pdf`**，而且只挂在一条公告的附件里，Files 页面对学生又是隐藏的。AI 从公告附件里找到它，并读出了全部题目。 |
| “这周有什么要交？我交了没？” | 列出 Assignment 4（周日截止，**未提交**）、每周小测和一次计分测验。课表里的上课事件会被过滤掉，不会淹没真正的截止日期。 |
| “把线性代数的课件全部下载下来” | 从模块、公告和作业页面里一共找到 12 个文件，存下 8 份不重复的 PDF（题目**和答案**）到 `Canvas/MATH1012/…`，字节完全相同的重复上传只存一份。再跑一次只花 2 秒，只下载新文件。 |
| “我申请了延期，现在还有哪些没交？” | `canvas_upcoming` 加上 `past_days`，可以同时看到逾期没交的和接下来要交的。 |
| “把 lab report 所有评分要求整理出来” | 一次读完作业说明、评分标准（课程用了 Canvas rubric 时），以及链接的 brief 和 sample essay PDF。 |
| “对照作业要求检查我的 SQL” | 作业说明 PDF 会转成文字，AI 可以逐条检查列的顺序、禁止使用的语法和格式要求。 |

### 持续登录（实测）

Canvas 和大部分学校的 SSO 用的是“会话 cookie”，浏览器一关就清空。所以服务器会把它们存在你的数据文件夹里，需要时再自动续期。以下是在一所大学的真实 Canvas 上测的结果（Okta SSO，前面有 Cloudflare 人机验证）：

| 情况 | 会发生什么 | 实测 |
|---|---|---|
| 平时使用 | 直接带着保存的 cookie 访问 Canvas，不启动浏览器 | 0.7 秒 |
| Canvas 会话过期，SSO 还记得你 | 弹出一个登录窗口去学校 SSO，**什么都不用输**就自动完成并关闭 | 9.9 秒 |
| SSO 也过期了（比如关机好几天） | 窗口会留着，等你像平时一样登录 | — |
| 无界面续期 | SSO 能直接跳回来的学校可以用。这所大学会被 Cloudflare 人机验证拦下，服务器会自动改用可见窗口，并记住这个选择。**本工具从不自动完成或绕过任何人机验证。** | — |

不想要弹窗的话，设置 `CANVAS_MCP_RENEW=hidden`，等 `status` 提示过期后自己运行 `login`。

### 验证记录

- **17 个自动测试**：用假的 Canvas 服务器加真实的 MCP 客户端，覆盖分页、cookie 续期、Files 页隐藏时的兜底、重复上传、setup 写入各个 AI 应用的配置，并确认只会发 `GET` 请求。
- **真机 60/60 项检查**：用真实账号、通过真实的 MCP 客户端运行（`node scripts/verify-live.mjs`）。覆盖 13 门课，每门课都查了模块、文件、作业和页面；还有公告、成绩、站内信、日历、近期待办，以及把讲义 PDF 转成文字。
- **模拟会话过期**：分别删掉 Canvas 的会话 cookie 和 SSO 的会话 cookie，结果见上表。
- **setup 测试**：在一个临时的用户目录里运行，Claude Desktop、Codex、Cursor 的配置都写对了，原有的服务器配置保留，也做了备份。

真机测试中发现并修好的问题：
- 漏掉了挂在公告附件里的作业 PDF。
- 上学期的课被当成了“当前课程”。
- 课表事件淹没了真正的截止日期。
- 同一份文件上传两次就会存两份。

### 隐私与使用须知

会话 cookie 保存在 `~/.canvas-session-mcp/session.json`，只有你的系统账户能读。请像对待密码一样对待它，删掉整个文件夹就等于退出登录。本项目是非官方工具，与 Instructure 无关，只读取你在自己浏览器里本来就能看到的内容，请求频率也和正常浏览差不多。请遵守学校的 IT 使用政策，不要外传课程资料，并遵守各科关于 AI 使用的规定。

## Development

```bash
npm install
npm test                       # 17 tests, fake Canvas
node scripts/verify-live.mjs   # live, read-only checks against your own Canvas
```

## License

MIT
