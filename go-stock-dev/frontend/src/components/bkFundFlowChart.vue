<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref, watch, computed} from "vue";
import {GetBKFundFlowListByDate, GetBKFundFlowTopListByDate, GetAllBKCodes} from "../../wailsjs/go/main/App";
import BKConstituentsModal from "./BKConstituentsModal.vue";
import * as echarts from "echarts";

const props = defineProps({
  darkTheme: {
    type: Boolean,
    default: false
  },
  chartHeight: {
    type: Number,
    default: 600
  }
})

const chartRef = ref(null)
const topList = ref<any[]>([])
const loading = ref(false)
const refreshInterval = ref<any>(null)
let chart: echarts.ECharts | null = null
let chartResizeObserver: ResizeObserver | null = null

function resizeChart() {
  if (chart && chartRef.value && chartRef.value.clientWidth > 0) {
    chart.resize()
  }
}

// 临时添加的板块
const extraSectors = ref<any[]>([])
const addCodeInput = ref('')
const allBKCodes = ref<any[]>([])
const addCodeOptions = computed(() => {
  const existCodes = new Set([
    ...inflowList.value.map((i: any) => i.code),
    ...outflowList.value.map((i: any) => i.code),
    ...extraSectors.value.map((i: any) => i.code)
  ])
  return allBKCodes.value
    .filter((i: any) => !existCodes.has(i.code))
    .map((i: any) => ({label: `${i.name} (${i.code})`, value: i.code, name: i.name}))
})

// 默认当天日期，格式 YYYY-MM-DD
const today = new Date()
const todayStr = today.getFullYear() + '-' +
  String(today.getMonth() + 1).padStart(2, '0') + '-' +
  String(today.getDate()).padStart(2, '0')
const selectedDate = ref(todayStr)

// 是否查看的是今天
const isToday = computed(() => selectedDate.value === todayStr)

// 流入前20
const inflowList = computed(() => topList.value.filter((item: any) => item.netInflow > 0).slice(0, 20))
// 流出前20
const outflowList = computed(() => topList.value.filter((item: any) => item.netInflow < 0).slice(-20).reverse())

// ===== 成分股弹窗 =====
const constituents = ref({show: false, code: '', name: ''})
function showBKConstituents(item: any) {
  if (!item?.code) return
  constituents.value = {show: true, code: item.code, name: item.name}
}

// ===== 播放功能 =====
const isPlaying = ref(false)
const playTimer = ref<any>(null)
const playSpeed = ref(1) // 倍速
const playIndex = ref(0)  // 当前播放到第几个时间点
const totalPoints = ref(0) // 总时间点数
const cachedAllData = ref<any[]>([]) // 缓存全量数据
const cachedTimes = ref<string[]>([]) // 缓存全量时间轴

onMounted(async () => {
  try {
    // 容器尺寸变化（窗口缩放 / 切换标签页）时自适应，避免画布宽度与容器不一致
    if (typeof ResizeObserver !== 'undefined' && chartRef.value) {
      chartResizeObserver = new ResizeObserver(resizeChart)
      chartResizeObserver.observe(chartRef.value)
    }
    window.addEventListener('resize', resizeChart)

    // 加载所有板块代码（供临时添加使用）
    const codes = await GetAllBKCodes()
    if (codes && Array.isArray(codes)) allBKCodes.value = codes

    await loadAllData()
    // 交易时间每分钟刷新（仅当天）
    refreshInterval.value = setInterval(async () => {
      if (isToday.value && isTradingTime()) {
        await loadAllData()
      }
    }, 60000)
  } catch (e) {
    console.error('onMounted error:', e)
  }
})

onBeforeUnmount(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value)
  }
  if (chartResizeObserver) {
    chartResizeObserver.disconnect()
    chartResizeObserver = null
  }
  window.removeEventListener('resize', resizeChart)
  stopPlay()
  if (chart) {
    chart.dispose()
  }
})

function isTradingTime(): boolean {
  const now = new Date()
  const h = now.getHours()
  const m = now.getMinutes()
  const t = h * 60 + m
  // 9:30 - 11:30 或 13:00 - 15:00
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900)
}

// 流入前20用红色系，流出前20用绿色系
function getSeriesColor(index: number, isInflow: boolean): string {
  const redShades = [
    '#ee6666', '#d14a61', '#fc8452', '#e8534e', '#c23531',
    '#f4755e', '#d4816a', '#e76f51', '#ef6c4a', '#d9534f',
    '#e74c3c', '#ff6b6b', '#ee5a24', '#f19066', '#e55039',
    '#eb4d4b', '#fc5c65', '#ff6348', '#e71d36', '#c0392b'
  ]
  const greenShades = [
    '#00da3c', '#3ba272', '#91cc75', '#2ecc71', '#27ae60',
    '#52be80', '#58d68d', '#45b39d', '#1abc9c', '#16a085',
    '#239b56', '#28b463', '#73c0de', '#48b8d0', '#87cefa',
    '#1dd1a1', '#10ac84', '#0abde3', '#01a3a4', '#00cec9'
  ]
  return isInflow ? redShades[index % redShades.length] : greenShades[index % greenShades.length]
}

// 日期禁用：不能选未来日期
function isDateDisabled(ts: number): boolean {
  return ts > Date.now()
}

async function loadAllData() {
  loading.value = true
  try {
    const date = selectedDate.value
    // 按日期获取板块排名
    const res = await GetBKFundFlowTopListByDate(date, 1000)
    if (!res || !Array.isArray(res) || res.length === 0) {
      topList.value = []
      return
    }
    topList.value = res

    // 流入前20 和 流出前20
    const inflowTop = res.filter((item: any) => item.netInflow > 0).slice(0, 20)
    const outflowTop = res.filter((item: any) => item.netInflow < 0).slice(-20).reverse()
    const sectors = [...inflowTop, ...outflowTop, ...extraSectors.value]

    const allData = await Promise.all(
      sectors.map(async (item: any) => {
        const points = await GetBKFundFlowListByDate(item.code, date)
        return {
          code: item.code,
          name: item.name,
          isInflow: item.isInflow !== undefined ? item.isInflow : item.netInflow > 0,
          points: points || []
        }
      })
    )

    stopPlay()
    renderChart(allData, true)
  } catch (e) {
    console.error('loadAllData error:', e)
  } finally {
    loading.value = false
  }
}

function extractTime(snapTime: string): string {
  if (!snapTime || typeof snapTime !== 'string') return ''
  if (snapTime.length >= 16) return snapTime.substring(11, 16)
  return String(snapTime)
}

// 丢弃9:29之前的时间点
function isValidTime(t: string): boolean {
  if (!t || t.length < 5) return false
  const h = parseInt(t.substring(0, 2), 10)
  const m = parseInt(t.substring(3, 5), 10)
  const mins = h * 60 + m
  return mins >= 569 // 9:29
}

// 统一构建 series：4 条线以上末端标签会互相压住，这里只给资金量绝对值最大的若干条显示
function buildSeriesList(allData: any[], times: string[]) {
  let inflowIdx = 0
  let outflowIdx = 0
  const built = allData.map((sector: any) => {
    const dataMap = new Map<string, number>()
    for (const pt of sector.points) {
      const t = extractTime(pt.snapTime)
      if (t && isValidTime(t)) dataMap.set(t, pt.netInflow || 0)
    }
    // 对齐到统一时间轴，缺失的时间点用 null
    const values = times.map(t => dataMap.has(t) ? dataMap.get(t)! : null)
    const color = getSeriesColor(sector.isInflow ? inflowIdx++ : outflowIdx++, sector.isInflow)
    let last: number | null = null
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] != null) {
        last = values[i]
        break
      }
    }
    return {sector, values, color, last: last ?? 0}
  })

  // 末端标签只保留 |净流入| 最大的 12 条，其余看悬浮提示/图例，避免右侧文字糊成一团
  const labelCodes = new Set(
    [...built]
      .sort((a, b) => Math.abs(b.last) - Math.abs(a.last))
      .slice(0, 12)
      .map(b => b.sector.code)
  )

  return built.map(({sector, values, color}) => ({
    name: sector.name,
    type: 'line' as const,
    data: values,
    smooth: true,
    showSymbol: false,
    lineStyle: {width: 2, color},
    itemStyle: {color},
    emphasis: {
      lineStyle: {width: 3},
      focus: 'series' as const
    },
    // 折线末尾显示名称+资金量
    endLabel: {
      show: labelCodes.has(sector.code),
      formatter: (p: any) => {
        const v = p.value
        if (v == null) return p.seriesName
        const sign = v > 0 ? '+' : ''
        return `${p.seriesName} ${sign}${(v / 100000000).toFixed(2)}亿`
      },
      color,
      fontSize: 11,
      fontWeight: 'bold',
      distance: 6
    },
    // 标签重叠时自动隐藏/纵向错开，避免多条线标签叠在一起
    labelLayout: {hideOverlap: true, moveOverlap: 'shiftY'}
  }))
}

function renderChart(allData: { code: string; name: string; isInflow: boolean; points: any[] }[], fullRender: boolean = false) {
  if (!allData || allData.length === 0) return

  // 收集所有时间点，去重并排序，丢弃9:29之前的
  const timeSet = new Set<string>()
  for (const sector of allData) {
    for (const pt of sector.points) {
      const t = extractTime(pt.snapTime)
      if (t && isValidTime(t)) timeSet.add(t)
    }
  }
  const times = Array.from(timeSet).sort()

  // 缓存全量数据供播放使用
  if (fullRender) {
    cachedAllData.value = allData
    cachedTimes.value = times
    totalPoints.value = times.length
    playIndex.value = times.length
  }

  // 构建每个板块的 series 数据，对齐到统一时间轴
  const seriesList = buildSeriesList(allData, times)

  if (!chart && chartRef.value) {
    chart = echarts.init(chartRef.value)
  }
  if (!chart) return

  const textColor = props.darkTheme ? '#aaa' : '#666'
  const dateLabel = selectedDate.value

  const option: echarts.EChartsOption = {
    backgroundColor: 'transparent',
    title: {
      text: `${dateLabel} 板块资金流向 - 多板块对比`,
      left: 16,
      top: 6,
      textStyle: {color: props.darkTheme ? '#ccc' : '#456', fontSize: 15}
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {type: 'cross'},
      borderWidth: 1,
      borderColor: props.darkTheme ? '#456' : '#ddd',
      backgroundColor: props.darkTheme ? 'rgba(30,30,60,0.9)' : 'rgba(255,255,255,0.95)',
      padding: 10,
      textStyle: {color: props.darkTheme ? '#ccc' : '#333', fontSize: 12},
      formatter: (params: any) => {
        if (!Array.isArray(params)) return ''
        const inflowItems = params.filter((p: any) => p.value != null && p.value > 0)
          .sort((a: any, b: any) => (b.value || 0) - (a.value || 0))
        const outflowItems = params.filter((p: any) => p.value != null && p.value < 0)
          .sort((a: any, b: any) => (a.value || 0) - (b.value || 0))

        const renderList = (items: any[]) => items.map((p: any) => {
          const val = (p.value / 100000000).toFixed(2)
          const sign = p.value > 0 ? '+' : ''
          return `${p.marker} ${p.seriesName} <b>${sign}${val}</b>`
        }).join('<br/>')

        let html = `<b>${params[0].axisValue}</b><br/>`
        html += '<div style="display:flex;gap:20px;">'
        html += `<div><div style="color:#ee6666;font-weight:bold;margin-bottom:4px;">流入</div>${renderList(inflowItems) || '-'}</div>`
        html += `<div><div style="color:#00da3c;font-weight:bold;margin-bottom:4px;">流出</div>${renderList(outflowItems) || '-'}</div>`
        html += '</div>'
        return html
      }
    },
    legend: {
      // 40 个板块平铺会占 3~4 行，改成单行滚动图例，把空间留给图表
      type: 'scroll',
      left: 16,
      right: 16,
      top: 32,
      orient: 'horizontal',
      align: 'left',
      itemWidth: 12,
      itemHeight: 8,
      itemGap: 10,
      textStyle: {color: textColor, fontSize: 11},
      icon: 'roundRect',
      pageIconColor: props.darkTheme ? '#aaa' : '#666',
      pageIconInactiveColor: props.darkTheme ? '#555' : '#ccc',
      pageIconSize: 10,
      pageTextStyle: {color: textColor, fontSize: 10}
    },
    grid: {
      left: 68,
      right: 150,
      top: 76,
      bottom: 64
    },
    xAxis: {
      type: 'category',
      data: times,
      boundaryGap: false,
      axisLine: {onZero: false, lineStyle: {color: props.darkTheme ? '#444' : '#ccc'}},
      splitLine: {show: false},
      axisLabel: {
        color: textColor,
        rotate: 0,
        fontSize: 10,
        hideOverlap: true,
        interval: times.length <= 20 ? 0 : Math.floor(times.length / 12)
      },
      axisTick: {lineStyle: {color: props.darkTheme ? '#444' : '#ccc'}}
    },
    yAxis: {
      name: '净流入/亿元',
      type: 'value',
      nameTextStyle: {color: textColor, fontSize: 11},
      axisLine: {show: true, lineStyle: {color: props.darkTheme ? '#444' : '#ccc'}},
      splitLine: {lineStyle: {color: props.darkTheme ? '#333' : '#eee', type: 'dashed'}},
      axisLabel: {
        color: textColor,
        fontSize: 11,
        formatter: (v: number) => (v / 100000000).toFixed(2)
      }
    },
    series: seriesList,
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0],
        start: 0,
        end: 100
      },
      {
        show: true,
        xAxisIndex: [0],
        type: 'slider',
        bottom: 8,
        height: 16,
        start: 0,
        end: 100,
        borderColor: props.darkTheme ? '#444' : '#ccc',
        fillerColor: props.darkTheme ? 'rgba(100,100,200,0.2)' : 'rgba(100,100,200,0.15)',
        handleStyle: {color: props.darkTheme ? '#666' : '#999'},
        textStyle: {color: textColor, fontSize: 10}
      }
    ]
  }

  chart.setOption(option, true)
  chart.resize()
}

// ===== 播放控制 =====
function startPlay() {
  if (cachedAllData.value.length === 0 || cachedTimes.value.length === 0) return
  playIndex.value = 0
  isPlaying.value = true
  tickPlay()
}

function tickPlay() {
  if (!isPlaying.value) return
  if (playIndex.value >= totalPoints.value) {
    isPlaying.value = false
    return
  }
  playIndex.value++
  renderPlayFrame()
  const interval = Math.max(50, 300 / playSpeed.value)
  playTimer.value = setTimeout(tickPlay, interval)
}

function renderPlayFrame() {
  const allData = cachedAllData.value
  const times = cachedTimes.value.slice(0, playIndex.value)

  if (times.length === 0) return

  const seriesList = buildSeriesList(allData, times)

  if (!chart) return

  chart.setOption({
    backgroundColor: 'transparent',
    xAxis: {data: times},
    series: seriesList
  })
}

function pausePlay() {
  isPlaying.value = false
  if (playTimer.value) {
    clearTimeout(playTimer.value)
    playTimer.value = null
  }
}

function stopPlay() {
  isPlaying.value = false
  if (playTimer.value) {
    clearTimeout(playTimer.value)
    playTimer.value = null
  }
  playIndex.value = cachedTimes.value.length
}

function togglePlay() {
  if (isPlaying.value) {
    pausePlay()
  } else {
    if (playIndex.value >= totalPoints.value) {
      playIndex.value = 0
    }
    isPlaying.value = true
    tickPlay()
  }
}

function onPlaySpeedChange(val: number) {
  playSpeed.value = val
}

function onSliderChange(val: number) {
  pausePlay()
  playIndex.value = val
  if (cachedAllData.value.length > 0) {
    renderPlayFrame()
  }
}

function addExtraSector(code: string) {
  if (!code) return
  const found = allBKCodes.value.find((i: any) => i.code === code)
  if (!found) return
  if (extraSectors.value.some((i: any) => i.code === code)) return
  const displayCodes = new Set([
    ...inflowList.value.map((i: any) => i.code),
    ...outflowList.value.map((i: any) => i.code)
  ])
  if (displayCodes.has(code)) {
    addCodeInput.value = ''
    return
  }
  extraSectors.value.push({code: found.code, name: found.name, netInflow: 0, isInflow: true})
  addCodeInput.value = ''
  loadAllData()
}

function removeExtraSector(code: string) {
  extraSectors.value = extraSectors.value.filter((i: any) => i.code !== code)
  loadAllData()
}

function onDateChange() {
  loadAllData()
}

watch(() => props.darkTheme, () => {
  loadAllData()
})

watch(() => props.chartHeight, () => {
  if (chart) chart.resize()
})
</script>

<template>
  <div style="width: 100%">
    <!-- 控制栏 -->
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
      <n-tag :bordered="false" type="error" size="small">红色系 = 流入前20</n-tag>
      <n-tag :bordered="false" type="success" size="small">绿色系 = 流出前20</n-tag>
      <n-tag :bordered="false" size="small" type="primary">点击板块名称可查看成分股</n-tag>
      <n-date-picker
          v-model:formatted-value="selectedDate"
          type="date"
          value-format="yyyy-MM-dd"
          :is-date-disabled="isDateDisabled"
          style="width: 150px"
          @update:formatted-value="onDateChange"
      />
      <n-button size="small" :loading="loading" @click="loadAllData">
        刷新
      </n-button>
      <n-select
          v-model:value="addCodeInput"
          :options="addCodeOptions"
          filterable
          placeholder="添加板块"
          style="width: 180px"
          @update:value="addExtraSector"
      />
      <n-tag
          v-for="item in extraSectors"
          :key="item.code"
          closable
          size="small"
          type="warning"
          @close="removeExtraSector(item.code)"
      >
        {{ item.name }}
      </n-tag>
      <n-text v-if="isToday" :depth="3" style="font-size: 12px; margin-left: auto;">
        交易时间自动每分钟刷新 (9:30-15:00)
      </n-text>
      <n-text v-else depth="3" style="font-size: 12px; margin-left: auto;">
        历史数据
      </n-text>
    </div>

    <!-- 播放控制栏 -->
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap;">
      <n-button size="small" :type="isPlaying ? 'warning' : 'primary'" @click="togglePlay">
        {{ isPlaying ? '暂停' : '播放' }}
      </n-button>
      <n-button size="small" @click="startPlay" :disabled="totalPoints === 0">
        重播
      </n-button>
      <n-text :depth="3" style="font-size: 12px;">
        {{ totalPoints > 0 ? `${playIndex} / ${totalPoints}` : '无数据' }}
      </n-text>
      <n-slider
          v-model:value="playIndex"
          :max="totalPoints"
          :min="0"
          :step="1"
          style="width: 200px"
          :disabled="totalPoints === 0"
          @update:value="onSliderChange"
      />
      <n-text :depth="3" style="font-size: 12px;">倍速</n-text>
      <n-select
          :value="playSpeed"
          :options="[
            {label: '0.5x', value: 0.5},
            {label: '1x', value: 1},
            {label: '2x', value: 2},
            {label: '4x', value: 4},
            {label: '8x', value: 8}
          ]"
          style="width: 75px"
          size="small"
          @update:value="onPlaySpeedChange"
      />
    </div>

    <!-- 折线图 -->
    <div ref="chartRef" style="width: 100%;" :style="{height: chartHeight + 'px'}"></div>

    <!-- 板块资金排名表格 - 并排展示 -->
    <div style="margin-top: 20px; display: flex; gap: 20px; align-items: flex-start;">
      <!-- 流入排名 -->
      <div style="flex: 1; min-width: 0;">
        <n-h3 :style="{color: '#ee6666'}">流入 Top 20</n-h3>
        <n-table striped size="small">
          <n-thead>
            <n-tr>
              <n-th>排名</n-th>
              <n-th>板块名称</n-th>
              <n-th>净流入/亿元</n-th>
            </n-tr>
          </n-thead>
          <n-tbody>
            <n-tr v-for="(item, idx) in inflowList" :key="item.code">
              <n-td>{{ idx + 1 }}</n-td>
              <n-td>
                <n-tag :bordered="false" type="error" size="small" style="cursor: pointer"
                       title="点击查看成分股" @click="showBKConstituents(item)">{{ item.name }}</n-tag>
              </n-td>
              <n-td>
                <n-text type="error">+{{ (item.netInflow / 100000000).toFixed(2) }}</n-text>
              </n-td>
            </n-tr>
            <n-tr v-if="inflowList.length === 0">
              <n-td colspan="3" style="text-align: center; color: #999;">暂无数据</n-td>
            </n-tr>
          </n-tbody>
        </n-table>
      </div>
      <!-- 流出排名 -->
      <div style="flex: 1; min-width: 0;">
        <n-h3 :style="{color: '#00da3c'}">流出 Top 20</n-h3>
        <n-table striped size="small">
          <n-thead>
            <n-tr>
              <n-th>排名</n-th>
              <n-th>板块名称</n-th>
              <n-th>净流入/亿元</n-th>
            </n-tr>
          </n-thead>
          <n-tbody>
            <n-tr v-for="(item, idx) in outflowList" :key="item.code">
              <n-td>{{ idx + 1 }}</n-td>
              <n-td>
                <n-tag :bordered="false" type="success" size="small" style="cursor: pointer"
                       title="点击查看成分股" @click="showBKConstituents(item)">{{ item.name }}</n-tag>
              </n-td>
              <n-td>
                <n-text type="success">{{ (item.netInflow / 100000000).toFixed(2) }}</n-text>
              </n-td>
            </n-tr>
            <n-tr v-if="outflowList.length === 0">
              <n-td colspan="3" style="text-align: center; color: #999;">暂无数据</n-td>
            </n-tr>
          </n-tbody>
        </n-table>
      </div>
    </div>

    <!-- 成分股弹窗 -->
    <BKConstituentsModal v-model:show="constituents.show"
                         :bk-code="constituents.code"
                         :bk-name="constituents.name"
                         :dark-theme="props.darkTheme"/>
  </div>
</template>

<style scoped>
</style>
