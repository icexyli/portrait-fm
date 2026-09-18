#requires -Version 5.1
<#
Portrait FM deployment. Only the explicitly listed package files are uploaded.
Uses the official GitHub CLI; does not read, print, or export your login token.
Creates a PUBLIC repository, or updates a repository carrying this project's marker.
No force push, no repository deletion, no global Git configuration changes.
#>
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$Repository = 'portrait-fm',
    [ValidatePattern('^[A-Za-z0-9-]+$')][string]$ExpectedOwner = 'icexyli',
    [ValidateRange(30,900)][int]$WaitSeconds = 300,
    [switch]$Yes,
    [switch]$OpenBrowser
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Root = $PSScriptRoot
$ProjectId = 'portrait-fm'
$ApiVersion = '2026-03-10'
$MarkerFile = 'portrait-fm.project.json'
$UploadFiles = @(
    'README.md', 'ASSETS.md', '.gitignore', $MarkerFile,
    'deploy-pages.ps1', 'deploy.cmd',
    'docs/index.html', 'docs/.nojekyll', 'docs/release.json',
    'docs/assets/style.css', 'docs/assets/app.js', 'docs/assets/favicon.svg',
    'docs/assets/background.webp', 'docs/assets/cover.webp', 'docs/assets/ambient-demo.mp3'
)

function Invoke-GhApi {
    param([string]$Endpoint, [string]$Method = 'GET', $Body = $null, [switch]$Allow404)
    $tempBody = $null
    $tempError = [IO.Path]::GetTempFileName()
    $oldPreference = $ErrorActionPreference
    try {
        $cliArgs = @('api', '--hostname', 'github.com', $Endpoint, '--method', $Method,
            '-H', 'Accept: application/vnd.github+json', '-H', "X-GitHub-Api-Version: $ApiVersion")
        if ($null -ne $Body) {
            $tempBody = [IO.Path]::GetTempFileName()
            [IO.File]::WriteAllText($tempBody, ($Body | ConvertTo-Json -Depth 30 -Compress), $Utf8)
            $cliArgs += @('--input', $tempBody)
        }
        # Redirect native stderr separately so Windows PowerShell 5.1 does not mix JSON and diagnostics.
        $ErrorActionPreference = 'Continue'
        $output = & gh @cliArgs 2> $tempError
        $code = $LASTEXITCODE
        $ErrorActionPreference = $oldPreference
        $errorText = [IO.File]::ReadAllText($tempError)
        if ($code -ne 0) {
            if ($Allow404 -and $errorText -match '\bHTTP 404\b') { return $null }
            throw "GitHub 接口调用失败：$Method $Endpoint`n$errorText"
        }
        $text = $output -join "`n"
        if ([string]::IsNullOrWhiteSpace($text)) { return $null }
        return ($text | ConvertFrom-Json)
    } finally {
        $ErrorActionPreference = $oldPreference
        if ($tempBody) { Remove-Item -LiteralPath $tempBody -Force -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $tempError -Force -ErrorAction SilentlyContinue
    }
}

function Confirm-Step([string]$Message) {
    if ($Yes) { return }
    if ((Read-Host "$Message [y/N]") -notmatch '^(?i)y(es)?$') { throw '已取消，不再执行后续修改。' }
}

try {
    Write-Host ''
    Write-Host '花间 · GitHub Pages 部署' -ForegroundColor Cyan
    Write-Host '仅发布包内的示例网页，不会上传浏览器里保存的个人照片与音乐。'
    foreach ($relative in $UploadFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Leaf)) {
            throw "缺少文件：$relative。请完整解压后运行。"
        }
    }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Host '需要先安装 GitHub 官方命令行工具，执行一次：' -ForegroundColor Yellow
        Write-Host 'winget install --id GitHub.cli --exact'
        throw '安装后重新打开终端，再运行 deploy.cmd。尚未修改任何仓库。'
    }
    # Check authentication without displaying or extracting any token.
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & gh auth status --hostname github.com *> $null
    $authCode = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    if ($authCode -ne 0) {
        Write-Host '请在浏览器中完成 GitHub 登录，无需将密码或令牌发到聊天里。'
        & gh auth login --hostname github.com --git-protocol https --web
        if ($LASTEXITCODE -ne 0) { throw 'GitHub 登录尚未完成。' }
    }
    $profile = Invoke-GhApi 'user'
    $owner = [string]$profile.login
    if ($owner -ine $ExpectedOwner) {
        throw "Logged in as $owner; expected $ExpectedOwner. Run gh auth switch --hostname github.com --user $ExpectedOwner, then retry."
    }
    $fullName = "$owner/$Repository"
    $repoUrl = "https://github.com/$fullName"
    $repo = Invoke-GhApi "repos/$fullName" -Allow404
    $created = $false
    if ($null -eq $repo) {
        Confirm-Step "创建公开仓库 $fullName，并发布包含默认图片与试听音频的网页？"
        Write-Host "[1/4] 正在创建仓库 $fullName ..."
        $repo = Invoke-GhApi 'user/repos' 'POST' @{
            name = $Repository; private = $false; auto_init = $true;
            description = 'Portrait FM - personal photo music player; static GitHub Pages site'
        }
        $created = $true
    } else {
        if ($repo.private) { throw '同名仓库为私有仓库，脚本不会改变其可见性。请另选仓库名称。' }
        $marker = Invoke-GhApi "repos/$fullName/contents/$MarkerFile" -Allow404
        if ($null -eq $marker -or -not $marker.PSObject.Properties['content']) {
            throw '同名仓库未标记为花间项目，已停止以防覆盖。请用 -Repository 指定其他名称。'
        }
        $remoteProject = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($marker.content)) | ConvertFrom-Json
        if ($remoteProject.project -ne $ProjectId) { throw '项目标记不匹配，未覆盖任何文件。' }
        Confirm-Step "更新公开仓库 $fullName 中的网页文件？其他路径会保留。"
        Write-Host "[1/4] 正在更新已有项目 $fullName ..."
    }
    $branch = [string]$repo.default_branch
    if ([string]::IsNullOrWhiteSpace($branch)) { throw 'GitHub did not return the default branch. Open the repository and retry after initialization.' }
    $branchPath = [uri]::EscapeDataString($branch)
    # Wait for the auto-initialized branch to be available before any further writes.
    $headRef = $null
    for ($i=0; $i -lt 8; $i++) {
        $headRef = Invoke-GhApi "repos/$fullName/git/ref/heads/$branchPath" -Allow404
        if ($null -ne $headRef) { break }
        Start-Sleep -Seconds 2
    }
    if ($null -eq $headRef) { throw "Repository initialized but branch is not ready: $repoUrl" }
    if ($created) {
        # Mark the repository first, so an interrupted upload can be safely resumed.
        $markerBytes = [IO.File]::ReadAllBytes((Join-Path $Root $MarkerFile))
        $null = Invoke-GhApi "repos/$fullName/contents/$MarkerFile" 'PUT' @{
            message = 'Initialize Portrait FM project marker'; branch = $branch;
            content = [Convert]::ToBase64String($markerBytes)
        }
        $headRef = Invoke-GhApi "repos/$fullName/git/ref/heads/$branchPath"
    }
    $parent = Invoke-GhApi "repos/$fullName/git/commits/$($headRef.object.sha)"
    Write-Host '[2/4] 正在上传包内指定文件 ...'
    $entries = @()
    foreach ($relative in $UploadFiles) {
        Write-Host "  $relative"
        $bytes = [IO.File]::ReadAllBytes((Join-Path $Root $relative))
        $blob = Invoke-GhApi "repos/$fullName/git/blobs" 'POST' @{
            content = [Convert]::ToBase64String($bytes); encoding = 'base64'
        }
        $entries += @{ path = $relative; mode = '100644'; type = 'blob'; sha = $blob.sha }
    }
    # Unique publication ID prevents a cached older site from being reported as deployed.
    $publicationId = [guid]::NewGuid().ToString('N')
    $publication = @{ project=$ProjectId; publicationId=$publicationId; publishedAt=[DateTime]::UtcNow.ToString('o') }
    $entries += @{ path='docs/deploy-meta.json'; mode='100644'; type='blob'; content=($publication | ConvertTo-Json -Compress) }
    $tree = Invoke-GhApi "repos/$fullName/git/trees" 'POST' @{ base_tree=$parent.tree.sha; tree=@($entries) }
    $commit = Invoke-GhApi "repos/$fullName/git/commits" 'POST' @{
        message='Publish Portrait FM static website'; tree=$tree.sha; parents=@($headRef.object.sha)
    }
    # force=false preserves other work: a concurrent commit causes a safe error, not an overwrite.
    $null = Invoke-GhApi "repos/$fullName/git/refs/heads/$branchPath" 'PATCH' @{ sha=$commit.sha; force=$false }
    Write-Host "[3/4] 正在配置 Pages：$branch /docs ..."
    $pages = Invoke-GhApi "repos/$fullName/pages" -Allow404
    $configuration = @{ build_type='legacy'; source=@{ branch=$branch; path='/docs' } }
    if ($null -eq $pages) {
        $pages = Invoke-GhApi "repos/$fullName/pages" 'POST' $configuration
    } else {
        $null = Invoke-GhApi "repos/$fullName/pages" 'PUT' $configuration
        $pages = Invoke-GhApi "repos/$fullName/pages"
    }
    # GitHub may already have started a build; a rejected duplicate request is not a failed publication.
    try { $null = Invoke-GhApi "repos/$fullName/pages/builds" 'POST' }
    catch { Write-Warning 'Explicit build request was not accepted; checking the actual site before reporting a result.' }
    $siteUrl = [string]$pages.html_url
    if ([string]::IsNullOrWhiteSpace($siteUrl)) { throw "Pages was configured but did not return a site URL. Check $repoUrl/settings/pages" }
    $siteUrl = $siteUrl.TrimEnd('/') + '/'
    $checkUrl = $siteUrl + 'deploy-meta.json?publication=' + $publicationId
    Write-Host "[4/4] 正在验证本次发布，最多等待 $WaitSeconds 秒 ..."
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    $ready = $false
    do {
        try {
            $live = Invoke-RestMethod -Uri $checkUrl -TimeoutSec 12 -Headers @{ 'Cache-Control'='no-cache' }
            if ($live.project -eq $ProjectId -and $live.publicationId -eq $publicationId) { $ready=$true; break }
        } catch { }
        $latest = Invoke-GhApi "repos/$fullName/pages/builds/latest" -Allow404
        if ($null -ne $latest -and $latest.commit -eq $commit.sha -and $latest.status -eq 'errored') {
            throw "GitHub Pages build failed: $($latest.error.message). Details: $repoUrl/actions"
        }
        Start-Sleep -Seconds 5
    } while ([DateTime]::UtcNow -lt $deadline)
    $result = @{
        status=$(if($ready){'ready'}else{'pending'}); repository=$repoUrl; siteUrl=$siteUrl;
        commit=$commit.sha; publicationId=$publicationId; checkUrl=$checkUrl
    }
    [IO.File]::WriteAllText((Join-Path $Root 'deploy-result.json'), ($result | ConvertTo-Json), $Utf8)
    Write-Host "仓库地址：$repoUrl"
    Write-Host "提交编号：$($commit.sha)"
    if ($ready) {
        Write-Host "已验证上线：$siteUrl" -ForegroundColor Green
        if ($OpenBrowser) { Start-Process $siteUrl }
        exit 0
    }
    Write-Warning "文件已提交、Pages 已配置，但尚未验证新版网页上线：$siteUrl"
    Write-Host "查看部署进度：$repoUrl/actions"
    Write-Host '未执行回滚或删除。待验证的发布信息已写入 deploy-result.json。'
    exit 2
} catch {
    Write-Host ''
    Write-Host ('已停止：' + $_.Exception.Message) -ForegroundColor Red
    Write-Host '未强制覆盖提交，也未删除仓库。此前已成功的步骤可能保留在 GitHub 上。'
    exit 1
}
