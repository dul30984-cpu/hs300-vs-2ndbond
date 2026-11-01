# 沪深300 · 两个看板

[![update-data](https://github.com/dul30984-cpu/hs300-vs-2ndbond/actions/workflows/update.yml/badge.svg)](https://github.com/dul30984-cpu/hs300-vs-2ndbond/actions/workflows/update.yml)

- **主看板**：https://dul30984-cpu.github.io/hs300-vs-2ndbond/
  沪深300全收益 vs 二级债基指数，标出“300 跌破二级债基”的时点。
- **ETF 占比**：https://dul30984-cpu.github.io/hs300-vs-2ndbond/etf.html
  头部四只沪深300ETF（510300 / 510310 / 159919 / 510330）资产净值之和 ÷ 沪深300流通市值。

两页均支持滚轮缩放、拖动平移、十字光标读数；顶部可切换区间。

## 数据更新

每个工作日北京时间 21:30 / 23:30，GitHub Actions（`.github/workflows/update.yml`）自动：

1. 抓取中证指数官网最新 H00300 收盘；
2. 拉取天天基金公开净值，重建二级债基指数（等权、分红再投资，按 Wind 885007 于 2026-10-16 的 5163.65 标定）；
3. 抓取乐咕乐股的“头部300ETF占比”序列；
4. 有变化才提交 `data.json` / `etf.json`，GitHub Pages 随即重新发布。

也可在 Actions 页面手动触发（workflow_dispatch）。

## 口径

- H00300：中证指数官网，日频。
- 二级债基：天天基金公开净值重建，非 Wind 官方序列。
- ETF 占比：乐咕乐股提供的公开序列，源站更新有滞后（页面标注最新日期）。
