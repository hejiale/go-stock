<script setup>

import {GetStockKLine} from "../../wailsjs/go/main/App";
import * as echarts from "echarts";
import {onBeforeUnmount, onMounted, ref} from "vue";
import _ from "lodash";

const {code, stockName, darkTheme, kDays, chartHeight} = defineProps({
  code: {
    type: String,
    default: ''
  },
  stockName: {
    type: String,
    default: ''
  },
  kDays: {
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

// 与 A 股习惯保持一致：红涨绿跌；深色背景下用更亮的色值，避免看不清
const upColor = '#f5222d';
const downColor = '#00d26a';
const kLineChartRef = ref(null);

let chart = null;
let resizeObserver = null;

onMounted(() => {
  handleKLine(code, stockName);
  // 弹窗/窗口尺寸变化时自适应，避免画布与容器宽度不一致
  if (typeof ResizeObserver !== 'undefined' && kLineChartRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (chart) chart.resize();
    });
    resizeObserver.observe(kLineChartRef.value);
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

function handleKLine(code, stockName) {
  if (!kLineChartRef.value) return;
  chart = echarts.init(kLineChartRef.value);
  chart.showLoading('default', {
    text: '加载中...',
    color: '#409eff',
    textColor: darkTheme ? '#c9cdd4' : '#4b5563',
    maskColor: 'rgba(0,0,0,0)'
  });

  GetStockKLine(code, stockName, 365).then(result => {
    if (!chart) return;
    if (!result || result.length === 0) {
      chart.hideLoading();
      return;
    }

    const categoryData = [];
    const values = [];
    const volumes = [];
    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      categoryData.push(item.day);
      // 成交量柱颜色：与前一交易日收盘比较，上涨红、下跌绿
      let flag = Number(item.close) > Number(item.open) ? 1 : -1;
      if (i > 0) {
        flag = Number(item.close) > Number(result[i - 1].close) ? 1 : -1;
      }
      values.push([
        Number(item.open),
        Number(item.close),
        Number(item.low),
        Number(item.high)
      ]);
      volumes.push([i, Number(item.volume) / 10000, flag]);
    }

    const lastIdx = values.length - 1;
    const lastClose = values[lastIdx][1];
    const prevClose = lastIdx > 0 ? values[lastIdx - 1][1] : lastClose;
    const changePct = prevClose ? ((lastClose - prevClose) / prevClose * 100) : 0;
    const isUp = lastClose >= prevClose;

    const textColor = darkTheme ? '#c9cdd4' : '#4b5563';
    const subTextColor = darkTheme ? '#8f959e' : '#6b7280';
    const titleColor = darkTheme
        ? (isUp ? '#ff6b6b' : '#3ddc84')
        : (isUp ? '#d9001b' : '#0a9e4a');
    const axisLineColor = darkTheme ? '#3a3f46' : '#d0d4da';
    const splitLineColor = darkTheme ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    // 按容器高度计算上下两块的布局，避免固定百分比留下大片空白
    const chartH = Number(chartHeight) || 500;
    const priceTop = 48;
    const priceHeight = Math.max(140, Math.round(chartH * 0.56));
    const volTop = priceTop + priceHeight + 28;
    const volLimit = chartH - volTop - 46;
    const volHeight = Math.max(24, Math.min(Math.round(chartH * 0.13), volLimit));

    const legendData = ['日K', 'MA5', 'MA10', 'MA20', 'MA30'];
    const maColors = {MA5: '#e6b422', MA10: '#409eff', MA20: '#b37feb', MA30: '#36cfc9'};

    let option = {
      title: {
        text: stockName + '  ' + categoryData[lastIdx] + '  ' + lastClose.toFixed(2) + '  '
            + (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%',
        left: 8,
        top: 6,
        textStyle: {
          color: titleColor,
          fontSize: 14,
          fontWeight: 600
        },
      },
      darkMode: darkTheme,
      animation: false,
      legend: {
        right: 12,
        top: 6,
        data: legendData,
        itemWidth: 14,
        itemHeight: 8,
        itemGap: 12,
        textStyle: {
          color: textColor,
          fontSize: 11
        },
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
        formatter: function (params) {
          let currentItemData = _.filter(params, (param) => param.seriesIndex === 0)[0]?.data;
          let ma5 = _.filter(params, (param) => param.seriesIndex === 1)[0]?.data;
          let ma10 = _.filter(params, (param) => param.seriesIndex === 2)[0]?.data;
          let ma20 = _.filter(params, (param) => param.seriesIndex === 3)[0]?.data;
          let ma30 = _.filter(params, (param) => param.seriesIndex === 4)[0]?.data;
          let volum = _.filter(params, (param) => param.seriesIndex === 5)[0]?.data;
          if (!currentItemData) return '';
          const idx = _.filter(params, (param) => param.seriesIndex === 0)[0]?.name;
          return idx + '<br>' +
              '开盘: ' + currentItemData[1] + '<br>' +
              '收盘: ' + currentItemData[2] + '<br>' +
              '最低: ' + currentItemData[3] + '<br>' +
              '最高: ' + currentItemData[4] + '<br>' +
              '成交量(万手): ' + (volum ? volum[1] : '-') + '<br>' +
              'MA5: ' + ma5 + '<br>' +
              'MA10: ' + ma10 + '<br>' +
              'MA20: ' + ma20 + '<br>' +
              'MA30: ' + ma30
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
      visualMap: {
        show: false,
        seriesIndex: 5,
        dimension: 2,
        pieces: [
          {
            value: -1,
            color: downColor
          },
          {
            value: 1,
            color: upColor
          }
        ]
      },
      grid: [
        {
          left: 58,
          right: 18,
          top: priceTop,
          height: priceHeight
        },
        {
          left: 58,
          right: 18,
          top: volTop,
          height: volHeight
        }
      ],
      xAxis: [
        {
          type: 'category',
          data: categoryData,
          boundaryGap: false,
          min: 'dataMin',
          max: 'dataMax',
          axisLine: {onZero: false, lineStyle: {color: axisLineColor}},
          axisTick: {lineStyle: {color: axisLineColor}},
          splitLine: {show: false},
          axisLabel: {show: true, color: subTextColor, fontSize: 10, hideOverlap: true},
          axisPointer: {
            z: 100
          }
        },
        {
          type: 'category',
          gridIndex: 1,
          data: categoryData,
          boundaryGap: false,
          min: 'dataMin',
          max: 'dataMax',
          axisLine: {onZero: false, lineStyle: {color: axisLineColor}},
          axisTick: {show: false},
          splitLine: {show: false},
          axisLabel: {show: false}
        }
      ],
      yAxis: [
        {
          scale: true,
          // 深色主题下关闭交替灰底，否则整块图会被灰色条带盖住、蜡烛看不清
          splitArea: {show: false},
          splitLine: {show: true, lineStyle: {color: splitLineColor}},
          axisLine: {show: true, lineStyle: {color: axisLineColor}},
          axisTick: {show: false},
          axisLabel: {show: true, color: subTextColor, fontSize: 10}
        },
        {
          scale: true,
          gridIndex: 1,
          splitNumber: 2,
          splitArea: {show: false},
          axisLabel: {show: false},
          axisLine: {show: false},
          axisTick: {show: false},
          splitLine: {show: false}
        }
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          start: 100 - kDays,
          end: 100
        },
        {
          show: true,
          xAxisIndex: [0, 1],
          type: 'slider',
          bottom: 6,
          height: 16,
          start: 100 - kDays,
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
      series: [
        {
          name: '日K',
          type: 'candlestick',
          data: values,
          itemStyle: {
            color: upColor,
            color0: downColor,
            borderColor: upColor,
            borderColor0: downColor
          },
          markPoint: {
            symbolSize: 38,
            label: {
              fontSize: 10,
              color: '#fff',
              formatter: function (param) {
                return param != null ? param.value + '' : '';
              }
            },
            data: [
              {
                name: '最高',
                type: 'max',
                valueDim: 'highest'
              },
              {
                name: '最低',
                type: 'min',
                valueDim: 'lowest'
              }
            ],
            tooltip: {
              formatter: function (param) {
                return param.name + '<br>' + (param.data.coord || '');
              }
            }
          },
          markLine: {
            symbol: ['none', 'none'],
            silent: true,
            lineStyle: {
              color: darkTheme ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
              type: 'dashed',
              width: 1
            },
            label: {
              color: subTextColor,
              fontSize: 10,
              position: 'insideStartTop'
            },
            data: [
              {
                name: '最高收盘',
                type: 'max',
                valueDim: 'close'
              },
              {
                name: '最低收盘',
                type: 'min',
                valueDim: 'close'
              }
            ]
          }
        },
        {
          name: 'MA5',
          type: 'line',
          data: calculateMA(5, values),
          smooth: true,
          showSymbol: false,
          lineStyle: {
            color: maColors.MA5,
            width: 1.2,
            opacity: 0.9
          }
        },
        {
          name: 'MA10',
          type: 'line',
          data: calculateMA(10, values),
          smooth: true,
          showSymbol: false,
          lineStyle: {
            color: maColors.MA10,
            width: 1.2,
            opacity: 0.9
          }
        },
        {
          name: 'MA20',
          type: 'line',
          data: calculateMA(20, values),
          smooth: true,
          showSymbol: false,
          lineStyle: {
            color: maColors.MA20,
            width: 1.2,
            opacity: 0.9
          }
        },
        {
          name: 'MA30',
          type: 'line',
          data: calculateMA(30, values),
          smooth: true,
          showSymbol: false,
          lineStyle: {
            color: maColors.MA30,
            width: 1.2,
            opacity: 0.9
          }
        },
        {
          name: '成交量(手)',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          itemStyle: {
            color: '#7fbe9e'
          },
          data: volumes
        }
      ]
    };
    chart.setOption(option);
    chart.resize();
    chart.hideLoading();
  }).catch((e) => {
    console.error('K线数据加载失败:', e);
    if (chart) chart.hideLoading();
  })
}

function calculateMA(dayCount, values) {
  var result = [];
  for (var i = 0, len = values.length; i < len; i++) {
    if (i < dayCount) {
      result.push('-');
      continue;
    }
    var sum = 0;
    for (var j = 0; j < dayCount; j++) {
      sum += +values[i - j][1];
    }
    result.push((sum / dayCount).toFixed(2));
  }
  return result;
}
</script>

<template>
  <div ref="kLineChartRef" style="width: 100%;height: auto;--wails-draggable:no-drag"
       :style="{height:chartHeight+'px'}"></div>
</template>

<style scoped>

</style>