# 花间 · 私人音乐空间

可上传照片、分别调整背景与唱片封面，并播放本地歌曲的静态音乐网页。

**交付状态：部署包已生成，尚未在 GitHub 上创建仓库或发布网站。**

## 最快发布方式：Windows

### 1. 安装 GitHub 官方命令行工具

已经安装 `gh` 可跳过。在 PowerShell 中执行：

```powershell
winget install --id GitHub.cli --exact
```

安装完成后重新打开终端。也可以通过 GitHub CLI 官方安装说明获取安装程序：
https://github.com/cli/cli#installation

### 2. 解压整个压缩包，运行部署入口

双击 `deploy.cmd`。也可以在包所在目录运行：

```powershell
.\deploy.cmd
```

脚本默认检查登录账号为 `icexyli`，仓库名为 `portrait-fm`。首次使用会通过 GitHub 官方命令行工具发起浏览器登录；按终端显示的设备验证码完成登录即可。不要把访问令牌、密码或设备验证码发给其他人。

脚本会在公开发布前询问确认，然后：

1. 新建公开仓库；同名仓库已存在时检查项目标记，防止覆盖其他项目。
2. 上传包内明确列出的网页文件及部署说明，不扫描或上传其他本地目录。
3. 将仓库默认分支中的 `/docs` 配置为 GitHub Pages 发布目录。
4. 检查线上 `deploy-meta.json` 是否包含本次发布的唯一编号，确认上线后显示地址并打开浏览器。

默认预期地址如下，**这只是发布成功后的预期地址，当前尚未上线**：

```text
https://icexyli.github.io/portrait-fm/
```

脚本始终以 GitHub 实际返回的 Pages 地址为准。仓库名、自定义域名或发布配置变化时，地址也可能不同。

### 更换仓库名称

```powershell
.\deploy.cmd -Repository huajian-player
```

默认仅部署到登录账号自己的仓库，不会写入组织仓库。另一个账号使用时需明确指定：

```powershell
.\deploy.cmd -ExpectedOwner YOUR_GITHUB_LOGIN -Repository portrait-fm
```

### 再次更新

修改 `docs` 中已有网页文件后，重新运行 `deploy.cmd`。脚本只更新允许上传的文件路径，保留其他文件；不会强制推送、删除仓库或更改已有私有仓库的可见性。

新增网页文件时，需要把其相对路径加入 `deploy-pages.ps1` 中的 `$UploadFiles`，防止部署时漏传。

## 无脚本发布方式

在自己的 GitHub 账号中新建公开仓库，保持文件夹结构上传本包。进入仓库的 **Settings → Pages**，选择 **Deploy from a branch**，分支选择仓库实际的默认分支（通常为 `main`），目录选择 **`/docs`**，保存。

此项目不需要编译，也不依赖 npm、Node.js、Python 或额外后端。分支目录发布方式已足够，不需要另写构建工作流。`.nojekyll` 已放在网站目录中。

GitHub 官方说明：
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## 目录

```text
portrait-fm-pages/
├─ docs/                         网站发布目录
│  ├─ index.html                 页面入口
│  ├─ .nojekyll
│  ├─ release.json               网页版本
│  └─ assets/
│     ├─ app.js                  播放器、取景、手势、本地保存
│     ├─ style.css               页面样式
│     ├─ background.webp         默认背景
│     ├─ cover.webp              默认唱片封面
│     ├─ ambient-demo.mp3        内置合成试听
│     └─ favicon.svg             网页图标
├─ deploy.cmd                    Windows 双击部署入口
├─ deploy-pages.ps1              部署脚本
├─ portrait-fm.project.json      防止误覆盖仓库的项目标记
├─ README.md
├─ ASSETS.md                     素材来源说明
└─ CHECKS.md                     本次检查记录与限制
```

运行脚本后，网站目录会另外发布 `deploy-meta.json`；本地会生成不上传的 `deploy-result.json`，记录仓库、提交编号、线上地址与验证状态。

## 网页使用

打开 `docs/index.html` 可以本地预览。网页不请求第三方字体、框架或图片服务。首次通过 Pages 访问时，需要正常连接网络来下载站点文件。

在“自定义 → 外观”中选择照片，拖动确定显示位置，用滚轮、滑块或双指缩放。背景与圆形唱片可以分别取景；保存后可点击“重新取景背景 / 重新取景唱片”继续调整，不需要重新选择同一文件。

背景取景框保留 16:9 画面，网站背景会根据当前屏幕铺满右侧区域。不同屏幕比例可能使画面边缘进一步裁切，可用外观面板中的位置和缩放选项微调。唱片封面按圆形显示。

上传照片时会保留长边不超过 2560 像素的处理后原图，重新取景不会反复对已经裁切的结果裁切。旧版本未保留的原图无法补回；这类图片只能基于现有画面继续调整，重新选一次原图后即可保留完整的可调整范围。

在“歌单”中选择本地音乐。支持歌词、循环/随机播放、收藏、主题、睡眠定时、全屏、沉浸模式和海报导出。播放需由用户点击触发。

## 哪些内容会公开

本包发布的是网页代码、默认示例图片和内置试听音频。访客在网页中选择的照片、歌曲、歌词与个性化设置仅在其浏览器中处理，不会写入 GitHub 仓库，也不会同步给其他访客。

本地保存依赖浏览器许可与可用空间。清理站点数据、隐私模式、换浏览器或更换网站地址可能影响保存。此前下载版网页中的个人设置不会随这个部署包搬到线上。

这份部署包不会导出你电脑浏览器中已经上传过的素材；我无法访问那部分内容。公开发布前，请检查默认图片与音频，并按需替换为你有权使用的素材，见 `ASSETS.md`。

## 故障与状态

- 找不到 `gh`：先安装 GitHub CLI，重新打开终端再运行。
- 登录账号不符：执行脚本提示的 `gh auth switch` 命令，或重新登录目标账号。
- 同名仓库属于其他项目：脚本会停止，使用 `-Repository` 指定新名称。
- API 提示 403：检查本地 GitHub 登录与仓库/Pages 权限。创建 Pages 需要相应写入权限。
- 尚未验证上线：脚本会显示 `pending`，不会报告成功。查看仓库 **Actions** 和 **Settings → Pages**，以及本地 `deploy-result.json`。
- 中途中断：已经完成的创建仓库或文件提交可能保留。脚本不会自动删除它们；先检查提示后再运行。

退出码：`0` 表示已验证本次发布上线，`2` 表示已提交并配置 Pages、仍待验证，`1` 表示停止或失败。

`deploy.cmd` 中的 `ExecutionPolicy Bypass` 仅作用于该次 PowerShell 进程，不会永久修改系统执行策略；组织强制的策略仍可能阻止执行。

## 部署脚本使用的官方接口

- GitHub CLI API 调用：https://cli.github.com/manual/gh_api
- 浏览器登录：https://cli.github.com/manual/gh_auth_login
- 创建仓库：https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user
- 创建文件树：https://docs.github.com/en/rest/git/trees#create-a-tree
- 提交与引用：https://docs.github.com/en/rest/git/refs#update-a-reference
- GitHub Pages 配置与构建：https://docs.github.com/en/rest/pages/pages

说明核对日期：2026-09-18。当前会话只完成了打包、网页检查和部署脚本编写，未执行远端创建、上传或发布。
