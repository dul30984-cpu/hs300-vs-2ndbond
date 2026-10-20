/* global echarts */
(function () {
  "use strict";

  var STATIC = !!window.STATIC_MODE;
  var DATA_URL = STATIC ? "data.json" : "/api/data";

  var state = {
    data: null,
    mode: "cal",          // cal | core
    years: 0,             // 0 = all
    chart: null,
    lastGenerated: null,
    pollTimer: null,
    buildPoll: null,
  };

  var $ = function (id) { return document.getElementById(id); };

  function pct(v) { return (v / 1000 - 1) * 100; }
  function fmtPct(v, signed) {
    var s = v >= 0 && signed ? "+" : "";
    return s + v.toFixed(1) + "%";
  }
  function fmtNum(v) {
    return v.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  }
  function fmt2(v) { return v.toFixed(3); }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  function setStatus(text, kind) {
    $("statusText").textContent = text;
    var dot = $("dot");
    dot.className = "dot" + (kind ? " " + kind : "");
  }

  function bondSeries() {
    return state.mode === "cal" ? state.data.bond_cal : state.data.bond_core;
  }

  function buildOption() {
    var d = state.data;
    var hsPct = d.hs300.map(pct);
    var bPct = bondSeries().map(pct);

    var marks = [];
    if (state.mode === "cal") {
      marks = (d.crossings || []).map(function (c) {
        var i = d.dates.indexOf(c.date);
        return {
          coord: [i, pct(c.hs300)],
          value: c.date.slice(0, 7),
          depth: c.depth,
        };
      });
    }

    return {
      animation: false,
      grid: { left: 58, right: 70, top: 34, bottom: 74 },
      legend: {
        top: 2, left: 6, itemWidth: 18, itemHeight: 3, icon: "rect",
        textStyle: { fontSize: 12, color: "#444" },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", label: { backgroundColor: "#555" } },
        backgroundColor: "rgba(255,255,255,.97)",
        borderColor: "#ddd",
        textStyle: { color: "#222", fontSize: 12 },
        formatter: function (ps) {
          if (!ps || !ps.length) return "";
          var i = ps[0].dataIndex;
          var h = hsPct[i], b = bPct[i];
          var ratio = bondSeries()[i] / d.hs300[i];
          var gap = b - h;
          return (
            '<div style="font-weight:600;margin-bottom:4px">' + d.dates[i] + "</div>" +
            '<div style="color:#111">● 300全收益 &nbsp;' + fmtNum(d.hs300[i]) + " &nbsp;" + fmtPct(h, true) + "</div>" +
            '<div style="color:#7b2d8e">● 二级债基 &nbsp;&nbsp;&nbsp;' + fmtNum(bondSeries()[i]) + " &nbsp;" + fmtPct(b, true) + "</div>" +
            '<div style="color:#666;margin-top:4px">债基/300 = ' + fmt2(ratio) +
            " &nbsp;｜&nbsp; 差额 " + fmtPct(gap, true) + "</div>"
          );
        },
      },
      xAxis: {
        type: "category",
        data: d.dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#ccc" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#777", fontSize: 11,
          formatter: function (v) {
            var y = v.slice(0, 4);
            var m = v.slice(5, 7);
            return m === "01" ? y : "";
          },
        },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#777", fontSize: 11, formatter: "{value}%" },
        splitLine: { lineStyle: { color: "#ececec" } },
        axisLine: { show: false },
      },
      dataZoom: [
        { type: "inside", start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: "slider", height: 18, bottom: 10, borderColor: "#e2e2e2",
          fillerColor: "rgba(123,45,142,.10)", handleStyle: { color: "#7b2d8e" },
          textStyle: { color: "#888", fontSize: 10 } },
      ],
      series: [
        {
          name: "沪深300全收益",
          type: "line",
          data: hsPct,
          showSymbol: false,
          sampling: "lttb",
          lineStyle: { width: 1.4, color: "#111" },
          itemStyle: { color: "#111" },
          emphasis: { disabled: true },
          markPoint: {
            symbol: "circle",
            symbolSize: 17,
            itemStyle: { color: "rgba(255,255,255,0)", borderColor: "#e03131", borderWidth: 2 },
            label: {
              show: true, position: "bottom", distance: 4,
              formatter: function (p) { return p.value; },
              color: "#c92a2a", fontSize: 10, fontWeight: 600,
            },
            data: marks,
          },
        },
        {
          name: state.mode === "core" ? "二级债基（核心口径）" : "二级债基",
          type: "line",
          data: bPct,
          showSymbol: false,
          sampling: "lttb",
          lineStyle: { width: 1.6, color: "#7b2d8e" },
          itemStyle: { color: "#7b2d8e" },
          emphasis: { disabled: true },
        },
      ],
    };
  }

  function render() {
    if (!state.chart) {
      state.chart = echarts.init($("chart"), null, { renderer: "canvas" });
      state.chart.on("dblclick", function () { setRange(0); });
    }
    var prev = null;
    try {
      var o = state.chart.getOption();
      if (o && o.dataZoom && o.dataZoom[0] && o.dataZoom[0].start != null) {
        prev = { start: o.dataZoom[0].start, end: o.dataZoom[0].end };
      }
    } catch (e) { /* first render */ }
    state.chart.setOption(buildOption(), true);
    if (prev) {
      state.chart.dispatchAction({ type: "dataZoom", start: prev.start, end: prev.end });
    } else {
      applyZoom();
    }
  }

  function applyZoom() {
    var d = state.data;
    var n = d.dates.length;
    var start = 0;
    if (state.years > 0) {
      var end0 = new Date(d.dates[n - 1]);
      var y = end0.getFullYear() - state.years;
      var iso = y + "-" + String(end0.getMonth() + 1).padStart(2, "0") + "-" + String(end0.getDate()).padStart(2, "0");
      for (var i = 0; i < n; i++) {
        if (d.dates[i] >= iso) { start = i; break; }
      }
    }
    state.chart.dispatchAction({ type: "dataZoom", startValue: start, endValue: n - 1 });
  }

  function setRange(years, silent) {
    state.years = years;
    var btns = document.querySelectorAll("#range button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("on", parseInt(btns[i].dataset.y, 10) === years);
    }
    if (state.data) applyZoom();
  }

  function renderStats() {
    var d = state.data;
    var n = d.dates.length - 1;
    var h = d.hs300[n], b = bondSeries()[n];
    $("mDate").textContent = d.dates[n];
    $("mHs").innerHTML = fmtNum(h) + " <span class='" + (pct(h) >= 0 ? "up" : "down") + "'>" +
      fmtPct(pct(h), true) + "</span>";
    $("mBond").innerHTML = fmtNum(b) + " <span class='" + (pct(b) >= 0 ? "up" : "down") + "'>" +
      fmtPct(pct(b), true) + "</span>";
    $("mRatio").textContent = fmt2(b / h);
    var days = (new Date(d.dates[n]) - new Date(d.dates[0])) / 86400000;
    var cagrH = Math.pow(h / 1000, 365.25 / days) - 1;
    var cagrB = Math.pow(b / 1000, 365.25 / days) - 1;
    $("mCagr").textContent = fmtPct(cagrH * 100, false) + " / " + fmtPct(cagrB * 100, false);
  }

  function renderCrossings() {
    var list = state.data.crossings || [];
    $("nCross").textContent = list.length;
    var box = $("crosslist");
    box.innerHTML = "";
    list.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "cross";
      row.innerHTML = "<span><b>" + c.date.slice(0, 7) + "</b> 至 " + c.end.slice(0, 7) +
        "</span><span>最深 " + c.depth.toFixed(1) + "%</span>";
      row.title = "点击放大到该时段";
      row.onclick = function () { zoomTo(c.date); };
      box.appendChild(row);
    });
  }

  function zoomTo(dateStr) {
    var d = state.data;
    var i = d.dates.indexOf(dateStr);
    if (i < 0) return;
    var n = d.dates.length;
    var span = Math.round(252 * 1.5); // ~1.5 years
    var start = Math.max(0, i - span), end = Math.min(n - 1, i + span);
    state.years = -1;
    var btns = document.querySelectorAll("#range button");
    for (var k = 0; k < btns.length; k++) btns[k].classList.remove("on");
    state.chart.dispatchAction({ type: "dataZoom", startValue: start, endValue: end });
  }

  function renderFoot() {
    var m = state.data.meta || {};
    $("sub").textContent = "2004-12-31 = 1000 ｜ 红圈：300全收益跌破二级债基 ｜ 数据截至 " + (m.hs300_last || "–");
    $("foot").innerHTML =
      "最后更新：" + (m.generated_at || "–") + "<br>" +
      "基金样本：" + (m.n_funds_broad || "–") + " 只（二级债基+偏债混合+一级债基）<br>" +
      "标定：按 Wind 885007 于 " + (m.anchor_date || "–") + " 的 " + fmtNum(m.anchor_value || 0) + " 点校准<br>" +
      "数据源：中证指数官网 / 天天基金公开净值" +
      (STATIC ? "<br>静态部署：页面为构建时的数据快照" : "");
  }

  function loadData() {
    return fetch(DATA_URL, { cache: "no-store" })
      .then(function (r) {
        if (r.status === 503) throw new Error("building");
        return r.json();
      })
      .then(function (d) {
        state.data = d;
        state.lastGenerated = (d.meta || {}).generated_at;
        renderStats();
        renderCrossings();
        renderFoot();
        render();
        if (STATIC) {
          setStatus("静态快照 · " + ((d.meta || {}).generated_at || ""), "");
        } else {
          setStatus("数据就绪 · " + (d.meta || {}).generated_at, "");
        }
      });
  }

  function pollMeta() {
    return fetch("/api/meta", { cache: "no-store" }).then(function (r) { return r.json(); })
      .then(function (m) {
        if (m.running) {
          setStatus("重建中 " + Math.round((m.progress || 0) * 100) + "% · " + (m.stage || ""), "busy");
          $("progress").style.display = "block";
          $("progress").firstElementChild.style.width = ((m.progress || 0) * 100) + "%";
          $("refresh").disabled = true;
        } else {
          $("progress").style.display = "none";
          $("refresh").disabled = false;
          if (m.error) {
            setStatus("上次重建失败：" + m.error, "err");
          } else if (state.data) {
            setStatus("数据就绪 · " + ((state.data.meta || {}).generated_at || ""), "");
          }
        }
        if (state.data && m.generated_at && m.generated_at !== state.lastGenerated && !m.running) {
          toast("数据已更新");
          loadData();
        }
        return m;
      })
      .catch(function () {});
  }

  function startRefresh() {
    if (STATIC) {
      toast("静态部署：更新需在本地重建数据后重新推送");
      return;
    }
    setStatus("请求刷新…", "busy");
    fetch("/api/refresh", { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        toast(j.started ? "已开始重建，约 1–3 分钟" : "已有任务在跑");
        $("progress").style.display = "block";
        clearInterval(state.buildPoll);
        state.buildPoll = setInterval(function () {
          pollMeta().then(function (m) {
            if (m && !m.running) {
              clearInterval(state.buildPoll);
              loadData();
            }
          });
        }, 2000);
      });
  }

  function boot() {
    loadData().then(function () {
      if (!STATIC) startPoll();
    }).catch(function (e) {
      if (String(e).indexOf("building") >= 0) {
        setStatus("首次构建数据中，请稍候…", "busy");
        $("progress").style.display = "block";
        setTimeout(boot, 2500);
      } else {
        setStatus("加载失败", "err");
      }
    });
  }
  function startPoll() {
    setInterval(pollMeta, 60000);
  }

  function init() {
    document.querySelectorAll("#range button").forEach(function (b) {
      b.onclick = function () { setRange(parseInt(b.dataset.y, 10)); };
    });
    $("refresh").onclick = startRefresh;
    if (STATIC) {
      $("refresh").style.display = "none";
    }
    $("mode").onclick = function () {
      state.mode = state.mode === "cal" ? "core" : "cal";
      $("mode").textContent = state.mode === "cal" ? "口径：标定 Wind" : "口径：原始重建";
      renderStats();
      render();
    };
    window.addEventListener("resize", function () { if (state.chart) state.chart.resize(); });
    boot();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
