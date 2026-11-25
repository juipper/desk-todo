# 待办 · DeskTodo

一个常驻 Windows 桌面的极简待办浮窗：无边框、置顶、透明圆角，抬眼就能看见今天还剩几件事。

## 下载

不想折腾环境，直接下 Releases 里的 **`todo.exe`**（免安装，双击即用，可放 U 盘）：

https://github.com/juipper/desk-todo/releases/latest

首次双击可能触发 SmartScreen「已保护你的电脑」，点「更多信息 → 仍要运行」即可（exe 未做代码签名）。

## 从源码跑

双击 **`启动.bat`**。首次运行会自动安装 Electron（约 100MB，走国内镜像），之后秒开。

也可以手动：

```bash
npm install
npm start
```

## 怎么用

| 操作 | 方式 |
| --- | --- |
| 加待办 | 顶部输入框输入标题，回车创建；“截止”“优先级”两个 chip 点开可选 |
| 完成 | 点左侧圆圈，卡片淡出并收进底部“已完成 N 项”，点开可撤销 |
| 删除 / 编辑 | 鼠标移到任务卡片右侧，点铅笔（编辑标题、备注、截止、优先级）或 × |
| 切换清单 | 顶部“全部 / 工作 / 生活 / 临时” chip |
| 收起 | 标题栏右上角 ▽；收起后是 220×60 横条，显示进度环和下一件事 |
| 显示 / 隐藏 | `Ctrl+Alt+T`，或托盘图标左键单击 |
| 移动 | 拖标题栏；位置自动记住 |
| 退出 | 托盘图标右键 → 退出 |

没有截止时间的任务不进主列表、也不计入今日进度，折叠在“待排期 N 项”里。

## 数据在哪

```
%APPDATA%\DeskTodo\tasks.json          # 全部数据（任务 + 设置）
%APPDATA%\DeskTodo\backup-YYYY-MM-DD.json   # 每日自动备份，保留 7 天
```

设置面板里可以“导出 JSON / 导入 JSON / 打开目录”。

## 目录结构

```
main.js              主进程：窗口、托盘、全局热键、存储、导入导出
preload.js           安全桥接（contextIsolation，仅暴露必要 API）
renderer/index.html  界面结构（展开态 + 收起态 + 浮层 + 设置）
renderer/style.css   配色、布局（浅色 / 深色主题变量）
renderer/app.js      渲染逻辑：排序、进度环、增删改、清单筛选
assets/icon.png      图标
启动.bat            一键启动
```

## 打包免安装 exe

```bash
npm run dist
```

产物在 `dist\todo.exe`（portable，双击即用，可放 U 盘；窗口里显示的仍叫“待办”）。

## 明确不做（v1）

不做系统通知/气泡/声音提醒，不做子任务、重复任务、拖拽排序、云同步、安装包。

## v2 备选

提醒、拖拽排序、子任务、重复任务、统计视图、全屏应用时自动隐藏。
