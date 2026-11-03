<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from "vue";
import {GetStockMoneyTrendByDay} from "../../wailsjs/go/main/App";
import * as echarts from "echarts";

const {code, name, darkTheme, days, chartHeight} = defineProps({
  code: {
    type: String,
    default: ''
  },
  name: {
    type: String,
    default: ''
  },
  days: {
    type: Number,
    default: 14
  },
  chartHeight: {
    type: Number,
    default: 500
  },
  darkTheme: {
    type: Boolean,
    default: false
  }
})

const LineChartRef = ref(null);
let chart: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  handleLine(code, days);
  // 容器尺寸变化（弹窗/悬浮层展开、窗口缩放）时自适应
  if (typeof ResizeObserver !== 'undefined' && LineChartRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (chart) chart.resize();
    });
    resizeObserver.observe(LineChartRef.value);
  }
  window.addEventListener('resize', handleResize);
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (chart) {
    chart.dispose();
    chart = null;
  }
})

function handleResize() {
  if (chart) chart.resize();
}

const handleLine = (code, days) => {
  if (!LineChartRef.value) return;
  chart = echarts.init(LineChartRef.value);
  chart.showLoading('default', {
    text: '加载中...',
    color: '#409eff',
    textColor: darkTheme ? '#c9cdd4' : '#4b5563',
    maskColor: 'rgba(0,0,0,0)'
  });

  GetStockMoneyTrendByDay(code, days).then(result => {
    if (!chart) return;
    if (!result || result.length === 0) {
      chart.hideLoading();
      return;
    }

    const categoryData = [];
    const netamount_values = [];
    const r0_net_values = [];
    const trades_values = [];
    const volume = [];

    let min = 0
    let max = 0
    for (let i = 0; i < result.length; i++) {
      const item = result[i]
      categoryData.push(item.opendate)
      netamount_values.push(Number((Number(item.netamount) / 10000).toFixed(2)))
      const price = Number(item.trade);
      trades_values.push(price)
      r0_net_values.push(Number((Number(item.r0_net) / 10000).toFixed(2)))

      if (min === 0 || min > price) {
        min = price
      }
      if (max < price) {
        max = price
      }

      if (i > 0) {
        const b = Number(Number(result[i].netamount) + Number(result[i - 1].netamount)) / 10000
        volume.push(Number(b.toFixed(2)))
      } else {
        volume.push(Number((Number(result[i].netamount) / 10000).toFixed(2)))
      }
    }

    const textColor = darkTheme ? '#c9cdd4' : '#4b5563';
    const subTextColor = darkTheme ? '#8f959e' : '#6b7280';
    const axisLineColor = darkTheme ? '#3a3f46' : '#d0d4da';
    const splitLineColor = darkTheme ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const chartH = Number(chartHeight) || 500;

    // 单根柱子最大宽度，避免 360 天数据在 14% 窗口里挤成一片
    const barMaxWidth = 12;

    // 布局：上方「资金 + 股价」、下方「累计净流入」，日期统一放最底部
    // top 适当下移，给标题/图例行和两个 Y 轴名称之间留出呼吸空间
    const top = 64;
    const priceHeight = Math.max(130, Math.round(chartH * 0.5));
    const bottomTop = top + priceHeight + 26;
    const bottomLimit = chartH - bottomTop - 50;
    const bottomHeight = Math.max(30, Math.min(Math.round(chartH * 0.15), bottomLimit));

    const option = {
      title: {
        text: name,
        left: 12,
        top: 8,
        textStyle: {
          color: darkTheme ? '#e5e7eb' : '#1f2937',
          fontSize: 14,
          fontWeight: 600
        }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          lineStyle: {
            color: darkTheme ? '#6b7280' : '#9ca3af',
            width: 1,
            opacity: 0.9
          }
        },
        borderWidth: 1,
        borderColor: darkTheme ? '#3a3f46' : '#d0d4da',
        backgroundColor: darkTheme ? 'rgba(28,28,32,0.96)' : 'rgba(255,255,255,0.98)',
        padding: 10,
        textStyle: {
          color: darkTheme ? '#d9dde3' : '#374151',
          fontSize: 12
        },
        formatter: function (params: any[]) {
          if (!Array.isArray(params) || params.length === 0) return '';
          let html = '<b>' + params[0].axisValue + '</b>';
          params.forEach((p: any) => {
            if (p.value == null || p.value === '-') return;
            const val = typeof p.value === 'object' ? p.value.value : p.value;
            let unit = '万';
            if (p.seriesName === '股价') unit = '元';
            const sign = (p.seriesName !== '股价' && val > 0) ? '+' : '';
            html += '<br/>' + p.marker + ' ' + p.seriesName + ': <b>' + sign + Number(val).toFixed(2) + unit + '</b>';
          });
          return html;
        }
      },
      axisPointer: {
        link: [
          {
            xAxisIndex: 'all'
          }
        ],
        label: {
          backgroundColor: darkTheme ? '#4b5563' : '#888'
        }
      },
      legend: {
        show: true,
        data: ['当日净流入', '主力当日净流入', '股价', '累计净流入'],
        top: 8,
        right: 12,
        itemWidth: 12,
        itemHeight: 8,
        itemGap: 12,
        textStyle: {
          color: textColor,
          fontSize: 11
        }
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          start: 86,
          end: 100
        },
        {
          show: true,
          xAxisIndex: [0, 1],
          type: 'slider',
          bottom: 6,
          height: 16,
          start: 86,
          end: 100,
          borderColor: axisLineColor,
          fillerColor: darkTheme ? 'rgba(64,158,255,0.15)' : 'rgba(64,158,255,0.12)',
          handleStyle: {color: darkTheme ? '#6b7280' : '#9ca3af'},
          moveHandleStyle: {color: darkTheme ? '#4b5563' : '#cbd5e1'},
          textStyle: {color: subTextColor, fontSize: 10},
          dataBackground: {
            lineStyle: {color: subTextColor, opacity: 0.35},
            areaStyle: {color: subTextColor, opacity: 0.12}
          }
        }
      ],
      grid: [
        {
          left: 66,
          right: 52,
          top: top,
          height: priceHeight
        },
        {
          left: 66,
          right: 52,
          top: bottomTop,
          height: bottomHeight
        },
      ],
      xAxis: [
        {
          type: 'category',
          data: categoryData,
          boundaryGap: false,
          min: 'dataMin',
          max: 'dataMax',
          axisPointer: {
            z: 100
          },
          axisLine: {onZero: false, lineStyle: {color: axisLineColor}},
          axisTick: {show: false},
          splitLine: {show: false},
          axisLabel: {show: false}
        },
        {
          gridIndex: 1,
          type: 'category',
          data: categoryData,
          boundaryGap: false,
          min: 'dataMin',
          max: 'dataMax',
          axisLine: {onZero: false, lineStyle: {color: axisLineColor}},
          axisTick: {show: false},
          splitLine: {show: false},
          axisLabel: {show: true, color: subTextColor, fontSize: 10, hideOverlap: true}
        }
      ],
      yAxis: [
        {
          name: '净流入/万',
          type: 'value',
          splitNumber: 4,
          nameTextStyle: {color: subTextColor, fontSize: 10, align: 'left'},
          nameGap: 10,
          axisLine: {show: false},
          axisTick: {show: false},
          splitLine: {show: true, lineStyle: {color: splitLineColor}},
          axisLabel: {color: subTextColor, fontSize: 10}
        },
        {
          name: '股价',
          type: 'value',
          min: min - 1,
          max: max + 1,
          minInterval: 0.01,
          position: 'right',
          nameTextStyle: {color: subTextColor, fontSize: 10, align: 'right'},
          nameGap: 10,
          axisLine: {show: false},
          axisTick: {show: false},
          splitLine: {show: false},
          axisLabel: {
            color: subTextColor,
            fontSize: 10,
            formatter: (v: number) => Number(v).toFixed(2)
          }
        },
        {
          gridIndex: 1,
          name: '累计/万',
          type: 'value',
          splitNumber: 2,
          nameTextStyle: {color: subTextColor, fontSize: 10, align: 'left'},
          nameGap: 10,
          axisLine: {show: false},
          axisTick: {show: false},
          splitLine: {show: true, lineStyle: {color: splitLineColor}},
          axisLabel: {color: subTextColor, fontSize: 10}
        },
      ],
      series: [
        {
          yAxisIndex: 0,
          name: '当日净流入',
          data: netamount_values,
          type: 'line',
          smooth: false,
          showSymbol: false,
          lineStyle: {
            width: 1.6,
            color: '#4da3ff'
          },
          itemStyle: {color: '#4da3ff'},
          z: 5
        },
        {
          yAxisIndex: 0,
          name: '主力当日净流入',
          data: r0_net_values,
          type: 'bar',
          barMaxWidth: barMaxWidth,
          itemStyle: {
            color: darkTheme ? 'rgba(47,191,113,0.75)' : 'rgba(47,191,113,0.65)'
          }
        },
        {
          yAxisIndex: 1,
          name: '股价',
          type: 'line',
          data: trades_values,
          smooth: true,
          showSymbol: false,
          lineStyle: {
            width: 1.6,
            color: '#f5a623'
          },
          itemStyle: {color: '#f5a623'},
          z: 6
        },
        {
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 2,
          name: '累计净流入',
          data: volume,
          barMaxWidth: barMaxWidth,
          itemStyle: {
            color: (p: any) => (p.value >= 0 ? '#f5a623' : '#2fbf71')
          }
        },
      ]
    };
    chart.setOption(option);
    chart.resize();
    chart.hideLoading();
  }).catch((e) => {
    console.error('资金趋势数据加载失败:', e);
    if (chart) chart.hideLoading();
  })
}
</script>

<template>
  <div ref="LineChartRef" style="width: 100%;height: auto;" :style="{height:chartHeight+'px'}"></div>
</template>

<style scoped>

</style>