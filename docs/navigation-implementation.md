# HuiVision 导航功能说明文档

## 1. 功能目标

本版本将导航能力从纯文字引导升级为“地图 + 路线 + 实时状态 + 轮询兜底”的混合模式：

- 支持输入目的地并启动导航
- 支持获取当前位置并逆地理编码
- 支持高德路线规划并渲染路径
- 支持实时位置上报
- 优先使用 WebSocket 接收状态推送
- WebSocket 失败后自动切换 HTTP 轮询
- 支持地图界面实时居中、显示当前位置与目的地

## 2. 前端页面结构

### 2.1 导航页
文件：`miniprogram/pages/navigation/navigation.*`

主要组成：

- 顶部：返回、搜索框、定位按钮、连接状态
- 中部：`map` 地图组件，显示路线、当前位置、目的地
- 底部：导航状态、当前提示、路线长度、距离终点、当前步骤、停止按钮

### 2.2 设置页
文件：`miniprogram/pages/setting/setting.*`

可调整参数：

- 导航更新频率
- 偏航阈值
- 到达阈值
- 默认城市（默认：济南）

设置会保存到本地缓存，键名：`huiVisionNavSettings`

## 3. 前端运行逻辑

### 3.1 启动导航
1. 用户输入目的地
2. 调用 `wx.getLocation` 获取当前位置
3. 请求后端 `/api/navigation/start`
4. 后端返回 `session_id`、`route_summary`、`route_points`、`markers`
5. 前端渲染地图路线
6. 优先尝试 WebSocket 连接
7. 同时启动位置定时上报
8. WebSocket 失败则自动启用 HTTP 轮询

### 3.2 实时更新
- 位置定时器周期性调用 `/api/navigation/location`
- 轮询模式周期性调用 `/api/navigation/status`
- 页面会同步更新：
  - 当前引导语
  - 导航状态
  - 距离终点
  - 当前步骤
  - 地图中心点
  - 路线/marker

### 3.3 停止导航
- 调用 `/api/navigation/stop`
- 清理位置定时器、轮询定时器、WebSocket
- 页面恢复到未开始状态

## 4. 后端接口

### 4.1 目的地搜索
`POST /api/navigation/search`

请求：
```json
{
  "keyword": "泉城广场",
  "city": "济南"
}
```

### 4.2 逆地理编码
`POST /api/navigation/reverse-geocode`

请求：
```json
{
  "lat": 36.6684,
  "lng": 117.1414
}
```

### 4.3 开始导航
`POST /api/navigation/start`

请求：
```json
{
  "destination_keyword": "泉城广场",
  "origin_lat": 36.6684,
  "origin_lng": 117.1414,
  "mode": "walk",
  "settings": {
    "update_interval_sec": 2,
    "offroute_threshold_m": 25,
    "arrive_threshold_m": 12,
    "default_city": "济南"
  }
}
```

返回包含：
- `session_id`
- `current_instruction`
- `route_summary`
- `route_points`
- `markers`

### 4.4 位置更新
`POST /api/navigation/location`

请求：
```json
{
  "session_id": "xxx",
  "lat": 36.6685,
  "lng": 117.1415
}
```

### 4.5 状态查询
`GET /api/navigation/status?session_id=xxx`

### 4.6 停止导航
`POST /api/navigation/stop`

### 4.7 WebSocket
`WS /api/navigation/ws?session_id=xxx`

## 5. 导航判断规则

- 更新间隔：默认 2 秒
- 偏航阈值：默认 25 米
- 到达阈值：默认 12 米
- 默认城市：济南

## 6. 前端展示规则

### 6.1 地图数据
- `markers`：显示当前位置、目的地
- `polyline`：显示路线
- `mapCenterLat/mapCenterLng`：地图中心
- `mapLatitude/mapLongitude`：当前定位点

### 6.2 状态数据
- `navigationState`：导航状态
- `routeHint`：当前引导语
- `routeSummaryText`：路线长度
- `distanceText`：距终点距离
- `currentStepText`：当前步骤
- `arrivedText`：到达提示

## 7. 真机联调建议

### 7.1 HTTP
优先确认手机可以访问后端接口地址。

### 7.2 WebSocket
如果真机 WebSocket 无法连接，会自动回退 HTTP 轮询，不影响导航主流程。

### 7.3 地图显示
真机上首先确认：
- `map` 组件能显示
- 当前点和终点 marker 能显示
- 路线 polyline 能显示

## 8. 后续扩展

后续可继续增加：
- 语音播报
- 自动跟随视角
- 方向箭头
- 更精细的路段匹配
- 偏航恢复建议
- 终点附近提示增强
