# VPS 剩余价值计算器

简洁明了的 VPS 剩余价值计算与论坛出售帖生成工具。

## 功能

- 剩余天数、日均成本、剩余价值、建议售价计算
- 免费汇率 API 自动获取，多源降级，支持缓存和手动汇率
- 文本、Markdown、URL 分享
- 结果卡片 PNG 图片导出
- 出售 VPS Markdown/纯文本生成
- localStorage 保存最近输入和最近 10 条历史记录

## 技术栈

- React + TypeScript + Vite
- html2canvas
- Cloudflare Pages 静态部署

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物位于 `dist/`。

## 隐私说明

本项目不需要服务端数据库。表单和历史记录默认只保存在当前浏览器的 localStorage 中。
