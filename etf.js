/* global echarts */
(function () {
  "use strict";

  var STATIC = !!window.STATIC_MODE;
  var URL = STATIC ? "etf.json" : "/api/etf";
  var $ = function (id) { return document.getElementById(id); };

  var state = { data: null, denom: "float", years: 0, chart: null };
  var DENOM = {
    float: { key: "ratio_float", label: "流通市值", mv: "float_mv" },
    free: { key: "ratio_free", label: "自由流通市值", mv: "free_mv" },
    total: { key: "ratio_total", label: "总市值", mv: "total_mv" },
  };

  function fmtMv(v) {
    if (v == null) return "–";
    return v >= 10000 ? (v / 10000).toFixed(2) + " 万亿" : Math.round(v).toLocaleString() + " 亿";
  }

  function buildOption() {
    var d = state.data, cfg = DENOM[state.denom];
    var ratio = d[cfg.key];
    var maxI = 0;
    for (var i = 1; i < ratio.length; i++) if (ratio[i] > ratio[maxI]) maxI = i;

    return {
      animation: false,
      grid: { left: 62, right: 66, top: 40, bottom: 74 },
      legend: { top: 4, left: 8, itemWidth: 18, itemHeight: 3, icon: "rect",
                textStyle: { fontSize: 12, color: "#444" } },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", label: { backgroundColor: "#555" } },
        backgroundColor: "rgba(255,255,255,.97)", borderColor: "#ddd",
        textStyle: { color: "#222", fontSize: 12 },
        formatter: function (ps) {
          if (!ps || !ps.length) return "";
          var i = ps[0].dataIndex;
          return '<div style="font-weight:600;margin-bottom:4px">' + d.dates[i] + "</div>" +
            '<div style="color:#c0392b">● 占比（' + cfg.label + '）&nbsp;' + d[cfg.key][i].toFixed(2) + "%</div>" +
            '<div style="color:#555">● 四只ETF合计 &nbsp;' + fmtMv(d.etf_mv[i]) + "</div>" +
            '<div style="color:#555">● 沪深300' + cfg.label + " &nbsp;" + fmtMv(d[cfg.mv][i]) + "</div>" +
            '<div style="color:#888;margin-top:3px">沪深300收盘 ' + (d.hs300[i] == null ? "–" : d.hs300[i].toFixed(2)) + "</div>";
        },
      },
      xAxis: {
        type: "category", data: d.dates, boundaryGap: false,
        axisLine: { lineStyle: { color: "#ccc" } }, axisTick: { show: false },
        axisLabel: { color: "#777", fontSize: 11,
          formatter: function (v) { return v.slice(5, 7) === "01" ? v.slice(0, 4) : ""; } },
      },
      yAxis: [
        { type: "value", name: "占比(%)", scale: true,
          nameTextStyle: { color: "#c0392b", fontSize: 11, padding: [0, 0, 0, -30] },
          axisLabel: { color: "#777", fontSize: 11, formatter: "{value}%" },
          splitLine: { lineStyle: { color: "#ececec" } }, axisLine: { show: false } },
        { type: "value", name: "沪深300", scale: true, position: "right",
          nameTextStyle: { color: "#999", fontSize: 11 },
          axisLabel: { color: "#999", fontSize: 10 },
          splitLine: { show: false }, axisLine: { show: false } },
      ],
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        { type: "slider", height: 18, bottom: 10, borderColor: "#e2e2e2",
          fillerColor: "rgba(192,57,43,.10)", handleStyle: { color: "#c0392b" },
          textStyle: { color: "#888", fontSize: 10 } },
      ],
      series: [
        {
          name: "占比（" + cfg.label + "）",
          type: "line", data: ratio, showSymbol: false,
          lineStyle: { width: 2, color: "#c0392b" },
          itemStyle: { color: "#c0392b" },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(192,57,43,.30)" },
            { offset: 1, color: "rgba(192,57,43,.02)" }]) },
          markPoint: {
            symbol: "circle", symbolSize: 7,
            itemStyle: { color: "#c0392b", borderColor: "#fff", borderWidth: 2 },
            label: { show: true, position: "top", distance: 6,
              formatter: function (p) { return p.value; },
              color: "#c0392b", fontSize: 11, fontWeight: 600 },
            data: [{ coord: [maxI, ratio[maxI]], value: "峰值 " + ratio[maxI].toFixed(2) + "%" }],
          },
        },
        {
          name: "沪深300收盘", type: "line", data: d.hs300, yAxisIndex: 1,
          showSymbol: false, lineStyle: { width: 1, color: "#b8bcc2" },
          itemStyle: { color: "#b8bcc2" }, emphasis: { disabled: true },
        },
      ],
    };
  }

  function applyZoom() {
    var n = state.data.dates.length, start = 0;
    if (state.years > 0) {
      var end0 = new Date(state.data.dates[n - 1]);
      var y = end0.getFullYear() - state.years;
      var iso = y + "-" + String(end0.getMonth() + 1).padStart(2, "0") + "-" + String(end0.getDate()).padStart(2, "0");
      for (var i = 0; i < n; i++) if (state.data.dates[i] >= iso) { start = i; break; }
    }
    state.chart.dispatchAction({ type: "dataZoom", startValue: start, endValue: n - 1 });
  }

  function render() {
    if (!state.chart) {
      state.chart = echarts.init($("chart"));
      state.chart.on("dblclick", function () { setRange(0); });
    }
    var prev = null;
    try {
      var o = state.chart.getOption();
      if (o && o.dataZoom && o.dataZoom[0] && o.dataZoom[0].start != null)
        prev = { start: o.dataZoom[0].start, end: o.dataZoom[0].end };
    } catch (e) {}
    state.chart.setOption(buildOption(), true);
    if (prev) state.chart.dispatchAction({ type: "dataZoom", start: prev.start, end: prev.end });
    else applyZoom();
  }

  function setRange(years) {
    state.years = years;
    document.querySelectorAll("#range button").forEach(function (b) {
      b.classList.toggle("on", parseInt(b.dataset.y, 10) === years);
    });
    if (state.data) applyZoom();
  }

  function renderStats() {
    var d = state.data, cfg = DENOM[state.denom], r = d[cfg.key];
    var n = r.length - 1;
    var maxI = 0, minI = 0;
    for (var i = 1; i < r.length; i++) {
      if (r[i] > r[maxI]) maxI = i;
      if (r[i] < r[minI]) minI = i;
    }
    $("mDate").textContent = d.dates[n];
    $("mRatio").textContent = r[n].toFixed(2) + "%";
    $("mEtf").textContent = fmtMv(d.etf_mv[n]);
    $("mMv").textContent = fmtMv(d[cfg.mv][n]);
    $("mClose").textContent = d.hs300[n] == null ? "–" : d.hs300[n].toFixed(2);
    $("mMax").textContent = r[maxI].toFixed(2) + "%（" + d.dates[maxI].slice(0, 7) + "）";
    $("mMin").textContent = r[minI].toFixed(2) + "%（" + d.dates[minI].slice(0, 7) + "）";
  }

  function renderFoot() {
    var m = state.data.meta || {};
    $("status").textContent = "数据截至 " + (m.last_date || "–");
    $("foot").innerHTML =
      "口径：华泰柏瑞510300 + 易方达510310 + 嘉实159919 + 华夏510330 四只ETF资产净值之和 ÷ 沪深300" +
      DENOM[state.denom].label + "。<br>" +
      "数据源：乐咕乐股（legulegu.com），" + (m.n || "–") + " 个交易日。<br>" +
      "注：源站更新有滞后，最新日期以图为准。";
  }

  function load() {
    fetch(URL, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.data = d;
        renderStats(); renderFoot(); render();
      })
      .catch(function () { $("status").textContent = "数据加载失败"; });
  }

  function init() {
    document.querySelectorAll("#range button").forEach(function (b) {
      b.onclick = function () { setRange(parseInt(b.dataset.y, 10)); };
    });
    document.querySelectorAll("#denom button").forEach(function (b) {
      b.onclick = function () {
        state.denom = b.dataset.d;
        document.querySelectorAll("#denom button").forEach(function (x) {
          x.classList.toggle("on", x === b);
        });
        renderStats(); renderFoot(); render();
      };
    });
    window.addEventListener("resize", function () { if (state.chart) state.chart.resize(); });
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
