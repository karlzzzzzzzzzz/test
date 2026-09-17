---
name: "unicloud-web-host-deploy"
description: "将前端构建产物部署到 uniCloud 前端网页托管（整个 dist 文件夹一键上传、云端清空、逐文件兜底、SPA回退、HTTP验证）。当用户要求部署/上传项目到 uniCloud 网页托管、bspapp、cloudstatic、env 服务空间时调用。"
---

# uniCloud 前端网页托管一键部署

通过自动化浏览器（integrated_code_mode 的 `tools.browser_*`）把本地前端项目的构建产物部署到 DCloud uniCloud「前端网页托管」，并以 HTTP 实测完成验证。

## 触发场景

- 用户说"部署/上传项目到 uniCloud / 网页托管 / bspapp"
- 给出 `unicloud.dcloud.net.cn/pages/web-host/web-host?pageid=env-xxxx` 链接
- 要求更新线上静态站点（可选"上传前先清空"）

## 前置条件

1. 控制台 URL 中带 `pageid=env-xxxxxxxx`（服务空间 ID）。没有时先让用户在控制台选定空间。
2. **登录必须由用户本人完成**：uniCloud 登录页表单在 iframe 内，严禁输入账号密码。跳转到 `/pages/login/login` 时，调用 `browser_waiting_for_user_interaction`（独立 toolcall）请用户在自动化浏览器窗口登录。外部 Chrome 的登录态与自动化浏览器不互通，不要尝试操作用户的外部浏览器。
3. 本地项目可构建（Vite 项目：`npm run build`，产物默认在 `dist/`）。

## 云厂商差异（先识别，影响域名与配置方式）

进入控制台后，顶部空间选择器会显示厂商，如 `sk（支付宝云）`。不同厂商能力不同：

- **默认域名形态不同**：支付宝云为 `{envId}-static.normal.cloudstatic.cn`；旧版/部分空间为 `xxxxx.bspapp.com`。**不要凭猜测拼域名**，一律以「参数配置 → 默认域名 → 查看默认域名」弹窗显示的为准。
- **配置项不同**：域名、网站首页、404页面三朵云都支持；「重定向规则」「缓存配置」仅腾讯云支持。
- **支付宝云/阿里云**：路由规则每天只能修改 3 次；404 页面仅支持根目录（history 模式只能用于根目录部署）。
- 官方文档：https://doc.dcloud.net.cn/uniCloud/hosting.html#routing

## 总体流程

1. 本地构建，枚举 **dist 下全部文件**（含 `public/` 拷贝到根目录的 favicon 等，不止 index.html 和 assets）
2. 浏览器打开托管页，确认登录态、识别云厂商、读取云端清单
3. **增量比对**：只上传缺失/有变化的文件；仅当用户明确要求时才清空云端
4. **首选：整个 dist 文件夹一键上传**（驱动系统原生选择框，自动保留 assets 层级，见步骤 5）；通道失败时降级为逐文件循环（步骤 6/7）
5. BrowserRouter 项目检查/配置路由回退；HashRouter 跳过
6. 获取默认域名，HTTP 实测首页、资源、子路由

> **重要更正（2026-09-12 实测）**：早期版本曾断言"文件夹选择框被 CDP 拦截、不弹窗、自动化不可行"——**该结论错误**。原生对话框会真实弹出且可被非沙箱 PowerShell（Win32 EnumWindows + SendKeys + 物理鼠标）稳定驱动，`browser_upload_file` 不支持目录只是浏览器工具自身的限制，不代表系统对话框不可操作。

## 关键技术坑点（必读）

uniCloud 控制台是 uni-app 编译的 H5，大量自定义元素，常规自动化手段会失效：

1. **`<uni-button>` 不响应坐标点击**：`browser_click` 点删除/创建目录/查看默认域名等 uni-button 无反应（不报错、不弹窗、无请求）。必须用 `browser_evaluate` 执行 `el.click()`。普通元素（tab、el-dialog 里的原生 button、el-dropdown menuitem）用 `browser_click` 正常。
2. **上传首选「上传文件夹（不含根目录）」+ 原生对话框驱动（一次传完整个 dist，自动建 assets 层级）**。浏览器工具点击菜单后，Windows 会真实弹出模态对话框（单文件框标题"打开"；文件夹框标题"**选择要上传的文件夹**"，类名 `#32770`，宿主进程是 Trae CN）。浏览器工具对它完全无效（`browser_press_key` 只发给网页），必须用**非沙箱** PowerShell（Shell 调用必须带 `dangerouslyDisableSandbox:true`）：
   - **沙箱内的窗口枚举（含 UIAutomation）看不到该对话框**——这不是没弹窗，是完整性级别隔离。早期"不弹窗/被 CDP 拦截"的误判即源于此；排错时可用非沙箱 `CopyFromScreen` 整屏截图眼见为实。
   - 对话框是 DirectUI 自绘控件：路径编辑框/按钮在 UIAutomation 里都是 `ControlType.Pane`，**ValuePattern / InvokePattern 均不支持**，`SendKeys '{ENTER}'` 也点不了"上传"（焦点在地址栏时只是重新导航）。
   - 可用驱动路径（已实测，完整脚本见步骤 5）：`EnumWindows` 按标题精确找到 hwnd → `SetForegroundWindow` → `SendKeys` `%d` 聚焦地址栏 → 剪贴板粘贴 dist 完整路径 → `{ENTER}` 导航 → UIA `FromHandle` 按 `Name='上传'` 找按钮取 `BoundingRectangle` → `SetCursorPos` + `mouse_event` 左键物理点击。
   - `browser_upload_file` 传目录路径会返回 Success 但实际 files=0（它只做 setInputFiles，不枚举目录）；这与"原生框可驱动"是两回事，不要混淆。
3. **文件夹提交成功的判定**：点"上传"后对话框标题变空（窗口关闭）；页面侧 `input.files` **立即被重置为 0**——这是正常现象，不能据此判失败。证据看 `.dialog-object-upload-log` 的「上传任务 N/N 成功」+ 刷新后文件表格。注意任务计数会**累积历史记录**（如显示 29/29），最终以云端表格的文件名/数量为准。
4. **上传面板是 el-drawer 抽屉**：完成后点 `.el-drawer__close-btn`（aria-label="Close this dialog"）关闭；关闭后 DOM 可能残留 display:flex 的动画节点，以截图/视觉为准，不要误判没关掉。
5. **逐文件兜底通道（仅当原生框驱动失败时）的坑**：① 「上传到当前目录」是 **hover 触发**的 el-dropdown；② DOM 中可能同时残留带 `webkitdirectory` 的 input，只选**非 webkitdirectory** 的：`[...document.querySelectorAll('input[type=file]')].find(i=>!i.hasAttribute('webkitdirectory'))`，给它改样式/打 aria-label 后快照取 ref；③ **每个文件必须走完整循环**（hover→点"上传文件"→重新取 ref→upload），同一 ref 连续 upload 只有第一个入队；④ upload 后立即读 `files.length` 必须为 1 且文件名正确；⑤ 一个 Exec 最多循环约 6 个文件（单文件约 8~9s），传完按最大文件留时间（约 1MB/20s）再核对。
6. **进入目录点 `.directory` 元素**，点 td 无效；进入后面包屑显示 `根目录/assets/`。**返回根目录不要用"返回上一级"按钮**（uni-button，`.click()` 实测可能不生效且不报错），应**点面包屑中的"根目录"链接**：`[...document.querySelectorAll('.breadcrumb-item,a,span,uni-button')].find(x=>x.textContent.trim()==='根目录').click()`，之后读快照确认面包屑为 `根目录 /` 再操作。
7. 逐文件兜底时，input 改可见后会遮挡上方按钮导致 hover 被拦截，把它定位到视口右下角空白处（`top:800px;left:700px`）。
8. **跨会话浏览器标签会全部消失**（`browser_tabs list` 为空）：重新 navigate 即可，cookie 登录态通常仍有效；若被重定向到登录页再请用户登录。
9. **页面数据是异步加载的**：导航/切目录后立即 evaluate 表格可能得到 undefined 或空行。先 `wait 2~3s`；读文件列表**优先用快照中的 `row: 文件名 | 大小 | ...` 行**，evaluate 查询偶发返回 undefined。
10. **不要用 `browser_navigate` 直接打开 SVG/图片等非 HTML 资源**，XML 文档会让快照抛 `GUEST_VIEW_MANAGER_CALL` 错误。验证资源状态码用 PowerShell `Invoke-WebRequest`（见步骤 9）。
11. 删除是危险操作：只有用户明确要求清空时才执行；同名文件直接上传即可覆盖。清空可在单个循环中批量执行（见步骤 4），不必每删一个就重新快照。

## 执行步骤

### 1. 构建并枚举全部产物

```shell
npm run build   # cwd: 项目根目录，如 d:\代码\test\react-app
```

用 Glob 枚举 `dist/**/*`（不是只看 `dist/assets/*`）：Vite 会把 `public/` 下的 `favicon.svg`、`icons.svg`、站点图标等原样拷到 dist **根目录**，漏传会导致 404。将产物分为：根目录文件清单、`assets/` 等子目录文件清单。

### 2. 打开控制台、确认登录与厂商

```js
await tools.browser_navigate({ url: "https://unicloud.dcloud.net.cn/pages/web-host/web-host?pageid=env-xxxx" });
await tools.browser_wait_for({ time: 3 });
```

- Page URL 含 `/pages/login/login` → 暂停，请用户登录后再继续。
- 已登录时在「文件管理」Tab；从顶部空间选择器记录云厂商（支付宝云/阿里云/腾讯云）。

### 3. 读取云端清单并做增量比对

快照读取当前目录表格的所有 `row:` 行（文件名、大小）；进入每个子目录分别读取。与步骤 1 的本地清单比对：

- **hash 命名且云端已存在同名文件（如 `index-CpcTB1IN.js`）→ 跳过**（内容等价，不必重传）。
- 根目录的 `index.html` 等非 hash 文件：对比大小，不一致则覆盖上传。
- 云端有、本地没有的文件：仅当用户要求"清空/镜像同步"时才删除。
- 得出本次"待上传清单"后再动手，避免无意义的重复上传。

### 4. 清空云端（仅用户明确要求时）

删除目录可整体递归删除，无需先进入。实测**可在一个循环中批量删除**（始终删第 0 个，DOM 自动刷新、索引前移）：触发删除等 1s → 点「确定删除」等 2s，重复 `danger` 按钮初始个数次。每轮记录剩余 danger 数（应逐轮 -1）作为证据：

```js
for (var n=0;n<N;n++){
  // 触发当前第 0 行红色删除按钮
  var b=document.querySelectorAll('uni-button[type=danger]');
  if(b.length){ b[0].click(); }
  // wait 1s 后在弹窗（标题"删除提示"）中点确定删除
  var c=[...document.querySelectorAll('button,uni-button')].find(x=>x.textContent.trim()==='确定删除');
  if(c){ c.click(); }
  // wait 2s 后进入下一轮
}
```

结束后必须快照确认列表显示 `暂无数据`（双保险可点「刷新」再读一次）。

### 5. 一键上传整个 dist 文件夹（首选，2026-09-12 实测打通）

确认面包屑是 `根目录/`，且页面**不在** assets 子目录里。

> **关键坑点（2026-09-17 实测）**：在 assets 子目录里触发文件夹上传会导致文件全部错位——`dist/index.html` 被传到 `root/assets/index.html`、`dist/assets/*` 被传到 `root/assets/assets/*`（嵌套），根目录文件不会被更新。**"返回上一级"按钮（uni-button）的 `.click()` 实测可能不生效**（不报错但不导航），不可依赖。回到根目录的可靠方式是**点击面包屑中的"根目录"链接**：`[...document.querySelectorAll('.breadcrumb-item,a,span,uni-button')].find(x=>x.textContent.trim()==='根目录').click()`。回到根目录后必须读快照确认面包屑文本是 `根目录 /`（不带子路径）再触发上传。

**5.1 浏览器侧触发菜单**（Exec 内）：`browser_hover`「上传到当前目录」→ 快照取 `menuitem "上传文件夹（不含根目录）"` ref → `browser_click`。点击后系统立即弹出标题为「选择要上传的文件夹」的模态框（"不含根目录"=只上传 dist 内部内容，index.html 直接落在网站根目录，assets 保持为子目录，正是我们要的）。

**5.2 非沙箱 PowerShell 驱动原生框**——Shell 工具必须带 `dangerouslyDisableSandbox:true`（沙箱内找不到该窗口）。以下脚本一次完成：EnumWindows 找 hwnd → Alt+D 地址栏粘贴 dist 路径 → 回车导航 → 找到「上传」按钮坐标物理点击：

```powershell
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;
public class WUp {
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
 public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,IntPtr e);
}
"@
$dist = 'd:\代码\test\react-app\dist'   # ← 改成实际 dist 绝对路径
$script:hwnd=[IntPtr]::Zero
$cb=[WUp+EnumWindowsProc]{ param($h,$l)
  if([WUp]::IsWindowVisible($h)){
    $sb=New-Object Text.StringBuilder 256;[void][WUp]::GetWindowText($h,$sb,256)
    if($sb.ToString() -eq '选择要上传的文件夹'){ $script:hwnd=$h }
  }
  return $true
}
[void][WUp]::EnumWindows($cb,[IntPtr]::Zero)
if($script:hwnd -eq [IntPtr]::Zero){ 'DIALOG NOT FOUND（检查菜单是否点成“上传文件”，其标题是“打开”）'; exit 1 }
[void][WUp]::SetForegroundWindow($script:hwnd); Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait('%d'); Start-Sleep -Milliseconds 300   # Alt+D 聚焦地址栏
Set-Clipboard -Value $dist
[System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); Start-Sleep -Milliseconds 1200  # 导航进 dist
# DirectUI“上传”按钮不支持 InvokePattern，用坐标物理点击
$el=[System.Windows.Automation.AutomationElement]::FromHandle($script:hwnd)
$cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'上传')
$up=$el.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$cond)
$r=$up.Current.BoundingRectangle
$cx=[int]($r.X+$r.Width/2);$cy=[int]($r.Y+$r.Height/2)
[void][WUp]::SetCursorPos($cx,$cy); Start-Sleep -Milliseconds 300
[WUp]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 80  # LEFTDOWN
[WUp]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)                                 # LEFTUP
Start-Sleep -Milliseconds 2000
$sb=New-Object Text.StringBuilder 256;[void][WUp]::GetWindowText($script:hwnd,$sb,256)
if($sb.ToString() -eq '选择要上传的文件夹'){'STILL OPEN（点击未生效，重跑坐标点击段）'}else{'SUBMITTED'}
```

排错备忘：
- 输出 `DIALOG NOT FOUND`：先非沙箱整屏截图（`CopyFromScreen`）确认框是否存在、标题是否不同；菜单点错成「上传文件」时标题是"打开"，可对它发 `SetForegroundWindow` + `SendKeys '{ESC}'` 关掉重来。
- 不要尝试 ValuePattern/InvokePattern/单纯 Enter——均已验证无效。
- 浏览器侧 `input.files` 提交后立刻归 0，不是失败信号。

**5.3 核对（双证据）**：
1. 等传输完成（约 1MB/20s，文件夹内全部文件并发上传），读 `.dialog-object-upload-log`：出现「上传任务 N/N 成功 N 失败 0」。计数可能包含历史任务（如 29/29），以本次时间戳条目为准。
2. evaluate 点页面「刷新」（`.click()`）→ wait 2s → 根目录应见 `index.html`、public 根文件和 `assets/`；点进 `.directory` 核对 assets 内文件数与本地 Glob 清单一致，缺谁再补。
3. 关闭上传抽屉：evaluate 点 `.el-drawer__close-btn`。

### 6. 兜底方案 A：逐文件循环（仅原生框通道失败时）

对**每个文件**（根目录 + assets 子目录分别进行，子目录需先「创建目录」assets 并点 `.directory` 进入）走完整循环，一个 Exec ≤6 个文件：

1. `browser_hover`「上传到当前目录」→ 快照点 `menuitem "上传文件"`（注意：此路径弹的是标题"打开"的系统框，但浏览器工具会在 CDP 层直接接管，无需也不能操作原生框）
2. evaluate 只给**非 webkitdirectory** 的 input 改样式打标：

```js
var ins=[...document.querySelectorAll('input[type=file]')];
ins.forEach(i=>{ if(!i.hasAttribute('webkitdirectory')){
  i.style.cssText='position:fixed;visibility:visible;z-index:99999;width:260px;height:60px;top:800px;left:700px;';
  i.setAttribute('aria-label','FILE_UP_READY');
}}); 'marked'
```

3. 快照找 `textbox "FILE_UP_READY" [eN]` → `browser_upload_file({ref,filePath})`
4. wait 1s 后读 `files.length`，必须为 `1 files: <文件名>`，否则重传：

```js
var inp=[...document.querySelectorAll('input[type=file]')].find(i=>!i.hasAttribute('webkitdirectory'));
inp ? inp.files.length+' files: '+(inp.files[0]?inp.files[0].name:'') : 'no-input'
```

5. 全部传完后同步骤 5.3 做双证据核对。

### 7. 兜底方案 B：请用户在自己的 Chrome 手动选文件夹

若两条自动化通道都失败，请用户在**本人 Chrome**（已登录 DCloud）打开同一托管页，用「上传文件夹（不含根目录）」选择本地 dist，随后由你负责刷新表格与 HTTP 核对。

### 8. 配置/检查 SPA 路由回退

切到「参数配置」Tab，找到「路由规则」区块（网站首页、404页面 + 编辑按钮）：

- **HashRouter 项目**：无需配置，跳过。
- **BrowserRouter 项目**：网站首页 `index`、404页面 `index.html`（值**不带前导斜杠**）。
- **支付宝云/阿里云的实际行为**：404 配成首页后，访问不存在的路径会 **302 跳转到 `/index.html`（浏览器地址会变）**，刷新深链最终渲染首页组件——这是官方支持的 history 方案（仅根目录部署有效），不是真正的同 URL rewrite，需向用户说明；路由规则每天限改 3 次。
- **腾讯云**：用「重定向规则」配置 `错误码 404 → 替换路径 → index.html`。
- 多项目同空间时只有根目录项目能用 history 模式。

### 9. 获取域名并做 HTTP 实测

获取默认域名：「参数配置 → 默认域名 → 查看默认域名」（uni-button，用 evaluate 的 `.click()`），弹窗标题"默认域名"，用快照或截图读取绿色链接（形如 `env-xxxx-static.normal.cloudstatic.cn` 或 `xxxxx.bspapp.com`）。有自定义域名则优先自定义域名。

验证方法：

- 首页与子路由：`browser_navigate` 打开域名根路径，evaluate 检查 `#root` 有子节点、h1 文本符合预期；再访问一个真实前端路由（如 `/resume`），确认最终落到 index.html 而非 404 页。刚覆盖上传后怀疑 CDN 旧缓存时，URL 加查询串（如 `?v=20260912`）可强制回源验证新版本。
- 静态资源与状态码：用 PowerShell（避免 navigate SVG/图片触发快照错误）：

```powershell
$base="https://env-xxxx-static.normal.cloudstatic.cn"
foreach($p in @("/favicon.svg","/icons.svg","/assets/index-xxxx.js","/resume")){
  try { $r=Invoke-WebRequest -Uri ($base+$p) -MaximumRedirection 5; "$p => $($r.StatusCode) final=$($r.BaseResponse.ResponseUri.AbsolutePath)" }
  catch { "$p => ERR $($_.Exception.Message)" }
}
```

期望：真实资源 200；子路由跟随重定向后 200 落在 `/index.html`。
- 覆盖更新 `index.html` 等非 hash 文件后 CDN 可能有缓存：腾讯云可在「缓存配置 → 刷新缓存」手动刷新；其他云用无痕窗口复验，等待几分钟生效（页面本身有提示语）。

## 完成汇报

向用户汇报：构建产物总数与分类、云厂商与域名、云端比对结果（跳过/上传/删除各哪些文件）、上传通道（文件夹一键 / 逐文件兜底 / 用户手动）与成功失败数、抽屉是否关闭、路由回退配置状态、HTTP 验证结果（首页/资源/子路由）。
