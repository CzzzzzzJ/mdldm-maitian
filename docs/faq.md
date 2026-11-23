# 常见问题

群里和会员场问得最多的几句。答案都能在本仓库里找到依据，出处标在句末。

## 会不会封号？

风险降低，但不是零。麦田对国内四家只填写、不发布，最后一下由你自己点；同一条视频每个平台只上传一次，中控的防重就是为这个；小红书只读页面上已经渲染的内容，像人一样滚动点击，低频操作。见 [各平台的坑](../README.md#各平台的坑实战总结)。

## Windows 上能用吗？

能。除了 macOS 的一行脚本，还有社区贡献的 Windows 脚本，要求 Windows 10/11、Node.js ≥ 22.5、Google Chrome，缺 Git / Node 时用 winget 自动补装；装完安装目录里有 4 个双击启动器（演示 / 登录 / 体检 / 启动）。开机自启还没适配，可以拿任务计划程序指向 `4-start.bat`。Windows 上踩过的三个坑和修法记在 [Windows 兼容性说明](windows-compat.md)。见 [一行装好](../README.md#一行装好)。

## 要一直开着电脑吗？

要。守护进程和专用 Chrome 都跑在你自己那台机器上，关机就不发、也不采数据。macOS 或 Windows 都行，长期开着即可。人不在家时用隧道在手机上看大屏，但跑的还是那台电脑。见 [README 开头](../README.md)和「远程访问」一节。

## 不会写代码能用吗？

能。装可以交给 AI 助手：把 [README「Agent 自动安装」](../README.md#agent-自动安装)里那段话复制给 Claude Code / Codex，它按 [安装指引](../agent-install.md)自己装好；也可以一行脚本装完跟着向导走。之后分三级：只看数据约 30 分钟，分发再多一小时，要接自己的站点才需要改代码。见 [三级上手](../README.md#三级上手)。

## 视频号为什么老掉线？

视频号的登录态本来就短，`config.json` 的 `keepAlive` 会给这类平台定时刷一下保活。还是掉了就在网页「系统 → 平台」里点「去登录」，只打开这一家的后台，在跑麦田的那台机器上用专用 Chrome 扫码。见 [README](../README.md) 的「配置要点（config.json）」和「平台管理」。

## 体检为什么要等很久？

`doctor` 要把每个平台的登录态和上传页都过一遍，平台越多越久。只查几家就加 `--only`：

```bash
node src/hub.mjs doctor --only douyin,channels
```

加 `--quiet` 就不发飞书通知。见 [README](../README.md) 的「命令」一节。

## 抖音提示「检测到高危插件」，页面暂停了？

专用 Chrome 里装了别的插件。篡改猴（Tampermonkey）、抓包 / 拦截请求这类插件会被抖音判成高危，整个页面暂停。专用 Chrome 里只留「麦田发布助手」，其他插件到 `chrome://extensions` 里删掉或停用，再刷新抖音后台。日常插件装在你平时用的 Chrome 里就行，两边互不影响。

## 还有问题？

到 [Discussions](https://github.com/CzzzzzzJ/mdldm-maitian/discussions) 问。
