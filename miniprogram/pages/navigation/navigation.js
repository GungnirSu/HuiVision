// pages/navigation/navigation.js
const DEBUG_NAV = true;
const NAV_SETTINGS_KEY = 'huiVisionNavSettings';
const DEFAULT_NAV_SETTINGS = {
  navUpdateIntervalSec: 2,
  navOffRouteThresholdM: 25,
  navArriveThresholdM: 12,
  navDefaultCity: '济南'
};
// 真机请求：须与手机能访问到的地址一致。
// - 同一热点/WiFi：填电脑 ipconfig 的 IPv4，API_BASE 用 http://该IP:8000，WS_BASE 用 ws://该IP:8000。
// - cpolar「TCP」隧道（如 tcp://36.tcp.cpolar.top:14908）：只转发原始 TCP，可用于 WebSocket：WS_BASE 写 ws://36.tcp.cpolar.top:14908（端口以控制台为准）。
//   wx.request 不能用 tcp://，HTTP 接口仍需「HTTP/HTTPS 网站类隧道」得到的 https 地址作 API_BASE，或继续用局域网 http。
// - 全走穿透且正式校验域名时：API_BASE 用 https 隧道；WS_BASE 用 wss；并在微信公众平台配置 request、socket 合法域名。
// const API_BASE = 'http://10.40.77.154:8000';
const API_BASE = 'http://172.23.150.154:8000';
const WS_BASE = 'ws://172.23.150.154:8000';
// 仅 WebSocket 走 cpolar TCP 隧道时（与 API_BASE 二选一组合需保证手机都能访问）：
// const WS_BASE = 'ws://36.tcp.cpolar.top:14908';
const NAV_WS_PATH = '/api/navigation/ws';

const quickOptions = [
  { id: 'toilet', label: '卫生间', icon: '🚻' },
  { id: 'subway', label: '地铁', icon: '🚇' },
  { id: 'restaurant', label: '餐厅', icon: '🍽️' },
  { id: 'supermarket', label: '超市', icon: '🛒' }
];

const DEFAULT_LOCATION = { latitude: 36.6684, longitude: 117.1414 };

/** 步行导航视野：与 map 组件 min-scale / max-scale 一致 */
const MAP_SCALE_MIN = 16;
const MAP_SCALE_MAX = 18;
const MAP_SCALE_DEFAULT = 17;

function clampMapScale(s) {
  const n = Number(s);
  if (Number.isNaN(n)) return MAP_SCALE_DEFAULT;
  return Math.max(MAP_SCALE_MIN, Math.min(MAP_SCALE_MAX, Math.round(n)));
}

function navLog(step, data) {
  if (!DEBUG_NAV) return;
  if (typeof data === 'undefined') {
    console.log(`[NAV DEBUG] ${step}`);
    return;
  }
  console.log(`[NAV DEBUG] ${step}`, data);
}

/** 上报位置：相对上次上报位移不足则跳过（米） */
const LOCATION_REPORT_MIN_M = 5;
const ROUTE_BLUE = '#007AFF';
const ROUTE_BLUE_DIM = '#8CB4FF';
const ROUTE_GRAY_DONE = '#CFD8DC';
const WS_OPEN_TIMEOUT_MS = 12000;
const WS_MAX_ATTEMPTS = 3;
const WS_RETRY_GAP_MS = 2000;

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function normalizeRoutePoints(routePoints) {
  if (!Array.isArray(routePoints)) return [];
  const out = [];
  routePoints.forEach((pt) => {
    const lat = typeof pt.lat === 'number' ? pt.lat : pt.latitude;
    const lng = typeof pt.lng === 'number' ? pt.lng : pt.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
      return;
    }
    out.push({ latitude: lat, longitude: lng });
  });
  return out;
}

/** 高德步行段 polyline：lng,lat;lng,lat */
function decodeAmapPolyline(poly) {
  if (!poly || typeof poly !== 'string') return [];
  const out = [];
  poly.split(';').forEach((item) => {
    const parts = item.split(',');
    if (parts.length < 2) return;
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      out.push({ latitude: lat, longitude: lng });
    }
  });
  return out;
}

function buildNavigationPolylines(state) {
  const navigating = state.is_navigating !== false;
  if (!navigating) return [];

  const rs = state.route_summary;
  if (rs && Array.isArray(rs.steps) && rs.steps.length > 0) {
    const cur = Math.max(0, Math.min(Number(state.current_step_index) || 0, rs.steps.length - 1));
    const lines = [];
    rs.steps.forEach((step, i) => {
      const pts = decodeAmapPolyline(step.polyline);
      if (pts.length < 2) return;
      if (i < cur) {
        lines.push({
          points: pts,
          color: ROUTE_GRAY_DONE,
          width: 5,
          arrowLine: false,
          borderColor: '#ECEFF1',
          borderWidth: 1,
          level: 'aboveroads',
        });
      } else if (i === cur) {
        lines.push({
          points: pts,
          color: ROUTE_BLUE,
          width: 9,
          arrowLine: true,
          borderColor: '#FFFFFF',
          borderWidth: 2,
          level: 'aboveroads',
        });
      } else {
        lines.push({
          points: pts,
          color: ROUTE_BLUE_DIM,
          width: 7,
          arrowLine: true,
          borderColor: '#FFFFFF',
          borderWidth: 1,
          level: 'aboveroads',
        });
      }
    });
    if (lines.length) return lines;
  }

  const mapPoints = normalizeRoutePoints(state.route_points || []);
  if (mapPoints.length > 1) {
    return [
      {
        points: mapPoints,
        color: state.is_off_route ? '#c2410c' : ROUTE_BLUE,
        width: 9,
        arrowLine: true,
        borderColor: '#FFFFFF',
        borderWidth: 2,
        level: 'aboveroads',
      },
    ];
  }
  return [];
}

Page({
  data: {
    destination: '',
    searchFocused: false,
    quickOptions,
    navigationState: '未开始导航',
    routeHint: '请输入目的地开始规划路线',
    isNavigating: false,
    currentLocationText: '未定位',
    sessionId: '',
    navSettings: DEFAULT_NAV_SETTINGS,
    connectionMode: 'idle',
    connectionHint: '未连接',
    wsConnected: false,
    mapCenterLat: DEFAULT_LOCATION.latitude,
    mapCenterLng: DEFAULT_LOCATION.longitude,
    mapLatitude: DEFAULT_LOCATION.latitude,
    mapLongitude: DEFAULT_LOCATION.longitude,
    scale: MAP_SCALE_DEFAULT,
    markers: [],
    polyline: [],
    routeSummaryText: '等待开始导航',
    distanceText: '--',
    currentStepText: '暂无步骤',
    arrivedText: ''
  },

  onLoad() {
    navLog('onLoad - 页面加载');
    const app = getApp();
    navLog('onLoad - app.globalData', app.globalData);
    if (!app.globalData.obstacleMonitorRunning) {
      navLog('onLoad - 启动障碍物监测');
      app.startObstacleMonitor();
    }
    this.ws = null;
    this.locationTimer = null;
    this.pollTimer = null;
    this.loadNavSettings();
    this.initMapCenter();
  },

  onUnload() {
    navLog('onUnload - 页面卸载');
    const app = getApp();
    app.globalData.lastNavigationDestination = this.data.destination;
    this.stopLocationTimer();
    this.stopFallbackPolling();
    this.closeWebSocket();
  },

  initMapCenter() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.setMapLocation(res.latitude, res.longitude, 'init');
      },
      fail: () => {
        this.setMapLocation(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude, 'fallback');
      }
    });
  },

  loadNavSettings() {
    const saved = wx.getStorageSync(NAV_SETTINGS_KEY) || {};
    const merged = { ...DEFAULT_NAV_SETTINGS, ...saved };
    navLog('loadNavSettings - 本地缓存', saved);
    navLog('loadNavSettings - 合并后的设置', merged);
    this.setData({ navSettings: merged });
  },

  onSearchFocus() {
    this.setData({ searchFocused: true });
  },

  onSearchBlur() {
    this.setData({ searchFocused: false });
  },

  onInputChange(e) {
    navLog('onInputChange - 用户输入', e.detail.value);
    this.setData({ destination: e.detail.value });
  },

  chooseQuickOption(e) {
    const { label } = e.currentTarget.dataset;
    navLog('chooseQuickOption - 快捷目的地', label);
    this.setData({
      destination: label,
      searchFocused: false,
      navigationState: `已选择目的地：${label}`,
      routeHint: '点击“开始导航”即可进入导航流程'
    });
  },

  bindSettings() {
    const saved = wx.getStorageSync(NAV_SETTINGS_KEY) || {};
    return { ...DEFAULT_NAV_SETTINGS, ...saved };
  },

  setMapLocation(latitude, longitude, source = 'manual') {
    this.setData({
      mapCenterLat: latitude,
      mapCenterLng: longitude,
      mapLatitude: latitude,
      mapLongitude: longitude,
      scale: clampMapScale(this.data.scale),
    });
    navLog(`setMapLocation - ${source}`, { latitude, longitude });
  },

  onMapRegionChange(e) {
    const d = e.detail || {};
    if (d.type !== 'end') return;
    const inner = d.detail || d;
    const s = typeof inner.scale === 'number' ? inner.scale : d.scale;
    if (typeof s !== 'number' || Number.isNaN(s)) return;
    const next = clampMapScale(s);
    if (next !== this.data.scale) {
      this.setData({ scale: next });
    }
  },

  renderRoute(state) {
    this.applyNavigationFromServer(state, {});
  },

  /**
   * 根据后端导航状态更新地图与文案；文案仅在内容变化时 setData，减少无意义刷新。
   */
  applyNavigationFromServer(state, opts) {
    const skipMapCenter = opts.skipMapCenter === true;
    const routeSummary = state.route_summary || {};
    const markers = Array.isArray(state.markers)
      ? state.markers.map((marker) => ({
        id: marker.id,
        latitude: marker.latitude,
        longitude: marker.longitude,
        width: marker.width || 24,
        height: marker.height || 24,
        iconPath: marker.iconPath,
        callout: marker.title
          ? {
            content: marker.title,
            display: 'BYCLICK',
            padding: 6,
            borderRadius: 8,
            bgColor: '#ffffff',
            color: '#1f2937',
          }
          : undefined,
      }))
      : [];

    const polyline = buildNavigationPolylines(state);
    const stepText = state.current_instruction || '导航中';
    const summaryText = routeSummary.distance_m
      ? `路线距离 ${Math.round(routeSummary.distance_m)} 米`
      : '路线已生成';
    const distStr =
      typeof state.distance_to_destination_m === 'number'
        ? `${Math.round(state.distance_to_destination_m)} 米`
        : '--';
    const navState = state.arrived ? '已到达目的地' : state.is_off_route ? '已偏航' : '导航中';
    const arrivedText = state.arrived ? '已到达目的地' : '';
    const hint = state.current_instruction || this.data.routeHint;

    const patch = { markers, polyline, routeSummaryText: summaryText };
    if (stepText !== this.data.currentStepText) {
      patch.currentStepText = stepText;
    }
    if (distStr !== this.data.distanceText) {
      patch.distanceText = distStr;
    }
    if (navState !== this.data.navigationState) {
      patch.navigationState = navState;
    }
    if (hint !== this.data.routeHint) {
      patch.routeHint = hint;
    }
    if (arrivedText !== this.data.arrivedText) {
      patch.arrivedText = arrivedText;
    }

    this.setData(patch);

    if (!skipMapCenter && state.current_lat && state.current_lng) {
      this.setMapLocation(state.current_lat, state.current_lng, 'state');
    }
  },

  openLocation() {
    navLog('openLocation - 点击定位');
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        navLog('openLocation - 定位成功', res);
        this.setMapLocation(res.latitude, res.longitude, 'location');
        this.setData({
          currentLocationText: `当前位置：${res.latitude.toFixed(6)}, ${res.longitude.toFixed(6)}`
        });
        wx.request({
          url: `${API_BASE}/api/navigation/reverse-geocode`,
          method: 'POST',
          header: { 'content-type': 'application/json' },
          data: { lat: res.latitude, lng: res.longitude },
          success: (resp) => {
            navLog('openLocation - 逆地理编码返回', resp.data);
            const address = resp.data?.data?.formatted_address || '未知位置';
            this.setData({ currentLocationText: `当前位置：${address}` });
          },
          fail: (err) => {
            navLog('openLocation - 逆地理编码失败', err);
          }
        });
      },
      fail: (err) => {
        navLog('openLocation - 定位失败', err);
        wx.showToast({ title: '定位失败', icon: 'none' });
      }
    });
  },

  startNavigation() {
    const destination = this.data.destination.trim();
    navLog('startNavigation - 点击开始', {
      destination,
      currentSettings: this.bindSettings()
    });

    if (!destination) {
      navLog('startNavigation - 目的地为空');
      wx.showToast({ title: '请输入目的地', icon: 'none' });
      return;
    }

    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        navLog('startNavigation - 获取起点成功', res);

        const settings = this.bindSettings();
        const requestData = {
          destination_keyword: destination,
          origin_lat: res.latitude,
          origin_lng: res.longitude,
          mode: 'walk',
          settings: {
            update_interval_sec: settings.navUpdateIntervalSec,
            offroute_threshold_m: settings.navOffRouteThresholdM,
            arrive_threshold_m: settings.navArriveThresholdM,
            default_city: settings.navDefaultCity
          }
        };

        navLog('startNavigation - 发送 start 请求', requestData);

        wx.request({
          url: `${API_BASE}/api/navigation/start`,
          method: 'POST',
          header: { 'content-type': 'application/json' },
          data: requestData,
          success: (resp) => {
            navLog('startNavigation - start 响应', resp.data);

            const data = resp.data?.data;
            if (!data) {
              navLog('startNavigation - 响应中没有 data');
              wx.showToast({ title: '导航启动失败', icon: 'none' });
              return;
            }

            navLog('startNavigation - 导航启动成功', data);
            this.setData({
              isNavigating: true,
              navigationState: `正在为你导航到 ${data.destination_name || destination}`,
              routeHint: data.current_instruction || '导航已启动',
              sessionId: data.session_id || '',
              currentLocationText: `当前位置：${res.latitude.toFixed(6)}, ${res.longitude.toFixed(6)}`,
              connectionHint: '正在尝试 WebSocket 连接...',
              connectionMode: 'ws',
              wsConnected: false,
              scale: MAP_SCALE_DEFAULT,
            });

            this._lastReportedLat = res.latitude;
            this._lastReportedLng = res.longitude;
            this.renderRoute(data);
            navLog('startNavigation - 已保存 sessionId', data.session_id);

            this.tryConnectWebSocket(data.session_id);
            this.startLocationLoop();
            wx.showToast({ title: '导航已启动', icon: 'success' });
          },
          fail: (err) => {
            navLog('startNavigation - 请求失败', err);
            wx.showToast({ title: '启动失败', icon: 'none' });
          }
        });
      },
      fail: (err) => {
        navLog('startNavigation - 获取起点失败', err);
        wx.showToast({ title: '请先授权定位', icon: 'none' });
      }
    });
  },

  tryConnectWebSocket(sessionId) {
    if (!sessionId) {
      navLog('tryConnectWebSocket - sessionId 为空，跳过');
      return;
    }
    this._cancelWebSocketTimers();
    this._openWebSocketAttempt(sessionId, 0);
  },

  _cancelWebSocketTimers() {
    if (this._wsOpenTimer) {
      clearTimeout(this._wsOpenTimer);
      this._wsOpenTimer = null;
    }
    if (this._wsRetryTimer) {
      clearTimeout(this._wsRetryTimer);
      this._wsRetryTimer = null;
    }
    if (this.wsOpenTimeout) {
      clearTimeout(this.wsOpenTimeout);
      this.wsOpenTimeout = null;
    }
  },

  _openWebSocketAttempt(sessionId, attemptIndex) {
    if (!sessionId || sessionId !== this.data.sessionId || !this.data.isNavigating) {
      return;
    }

    this.closeWebSocket();

    const wsUrl = `${WS_BASE}${NAV_WS_PATH}?session_id=${encodeURIComponent(sessionId)}`;
    navLog('tryConnectWebSocket - 尝试连接', { attemptIndex: attemptIndex + 1, wsUrl });

    this.setData({
      connectionMode: 'ws',
      connectionHint: `正在连接 WebSocket (${attemptIndex + 1}/${WS_MAX_ATTEMPTS})...`,
      wsConnected: false,
    });

    let socketTask;
    try {
      socketTask = wx.connectSocket({ url: wsUrl });
      this.ws = socketTask;
    } catch (error) {
      navLog('tryConnectWebSocket - wx.connectSocket 异常', error);
      this._onWebSocketAttemptFailed(sessionId, attemptIndex);
      return;
    }

    this._wsOpenTimer = setTimeout(() => {
      this._wsOpenTimer = null;
      navLog('tryConnectWebSocket - 连接超时', { attemptIndex });
      this.closeWebSocket();
      this._onWebSocketAttemptFailed(sessionId, attemptIndex);
    }, WS_OPEN_TIMEOUT_MS);

    socketTask.onOpen(() => {
      navLog('WebSocket onOpen - 连接成功');
      if (this._wsOpenTimer) {
        clearTimeout(this._wsOpenTimer);
        this._wsOpenTimer = null;
      }
      this.setData({
        wsConnected: true,
        connectionMode: 'ws',
        connectionHint: 'WebSocket 已连接',
      });
      this.stopFallbackPolling();
    });

    socketTask.onMessage((res) => {
      try {
        const msg = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        const payload = msg.payload || {};
        if (payload && (payload.session_id || payload.route_points || payload.current_instruction !== undefined)) {
          this.applyNavigationFromServer(payload, {});
        }
        if (payload.arrived) {
          this.stopNavigation(true);
        }
      } catch (e) {
        navLog('WebSocket onMessage - 解析失败', e);
      }
    });

    socketTask.onError((err) => {
      navLog('WebSocket onError', err);
      if (this._wsOpenTimer) {
        clearTimeout(this._wsOpenTimer);
        this._wsOpenTimer = null;
      }
      this.closeWebSocket();
      this._onWebSocketAttemptFailed(sessionId, attemptIndex);
    });

    socketTask.onClose(() => {
      navLog('WebSocket onClose');
      if (this._wsManualClose) {
        this._wsManualClose = false;
        return;
      }
      if (this._wsOpenTimer) {
        clearTimeout(this._wsOpenTimer);
        this._wsOpenTimer = null;
      }
      const hadBeenOpen = this.data.wsConnected;
      this.setData({ wsConnected: false });
      if (hadBeenOpen && this.data.connectionMode === 'ws' && this.data.isNavigating) {
        this.switchToPolling('WebSocket 已断开，已切换轮询');
      }
    });
  },

  _onWebSocketAttemptFailed(sessionId, attemptIndex) {
    if (!this.data.isNavigating || sessionId !== this.data.sessionId) {
      return;
    }
    if (this.data.wsConnected) {
      return;
    }
    if (attemptIndex < WS_MAX_ATTEMPTS - 1) {
      this._wsRetryTimer = setTimeout(() => {
        this._wsRetryTimer = null;
        this._openWebSocketAttempt(sessionId, attemptIndex + 1);
      }, WS_RETRY_GAP_MS);
    } else {
      this.switchToPolling('WebSocket 连接失败，已切换轮询');
    }
  },

  switchToPolling(hint) {
    navLog('switchToPolling - 切换轮询', hint);
    this._cancelWebSocketTimers();
    this.closeWebSocket();
    this.setData({
      connectionMode: 'polling',
      connectionHint: hint || '当前使用轮询模式',
      wsConnected: false,
    });
    this.startFallbackPolling();
  },

  startFallbackPolling() {
    if (this.pollTimer) {
      navLog('startFallbackPolling - 轮询已存在，跳过');
      return;
    }

    const interval = this.data.navSettings.navUpdateIntervalSec || 2;
    navLog('startFallbackPolling - 启动轮询', {
      interval,
      sessionId: this.data.sessionId
    });

    this.pollTimer = setInterval(() => {
      if (!this.data.sessionId || !this.data.isNavigating) {
        navLog('startFallbackPolling - 轮询跳过', {
          sessionId: this.data.sessionId,
          isNavigating: this.data.isNavigating
        });
        return;
      }
      this.queryNavigationStatus();
    }, interval * 1000);
  },

  stopFallbackPolling() {
    if (this.pollTimer) {
      navLog('stopFallbackPolling - 停止轮询');
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },

  stopLocationTimer() {
    if (this.locationTimer) {
      navLog('stopLocationTimer - 停止位置定时器');
      clearInterval(this.locationTimer);
      this.locationTimer = null;
    }
  },

  closeWebSocket() {
    this._cancelWebSocketTimers();
    if (this.ws) {
      navLog('closeWebSocket - 关闭WS');
      this._wsManualClose = true;
      const w = this.ws;
      this.ws = null;
      try {
        w.close({});
      } catch (e) {
        navLog('closeWebSocket - 关闭失败', e);
      }
    }
  },

  startLocationLoop() {
    this.stopLocationTimer();
    const interval = this.data.navSettings.navUpdateIntervalSec || 2;
    navLog('startLocationLoop - 启动位置定时器', { interval });
    this.locationTimer = setInterval(() => {
      if (!this.data.sessionId || !this.data.isNavigating) {
        navLog('startLocationLoop - 跳过定位上传', {
          sessionId: this.data.sessionId,
          isNavigating: this.data.isNavigating
        });
        return;
      }
      wx.getLocation({
        type: 'gcj02',
        success: (res) => {
          navLog('startLocationLoop - 定位成功，准备上报', res);
          this.updateLocation(res.latitude, res.longitude);
        },
        fail: (err) => {
          navLog('startLocationLoop - 定位失败', err);
        }
      });
    }, interval * 1000);
  },

  updateLocation(lat, lng) {
    if (!this.data.sessionId) {
      navLog('updateLocation - sessionId 为空');
      return;
    }

    if (
      this._lastReportedLat != null &&
      this._lastReportedLng != null
    ) {
      const moved = haversineM(lat, lng, this._lastReportedLat, this._lastReportedLng);
      if (moved < LOCATION_REPORT_MIN_M) {
        navLog('updateLocation - 位移不足，跳过上报', { movedM: moved });
        return;
      }
    }

    this._lastReportedLat = lat;
    this._lastReportedLng = lng;

    const payload = {
      session_id: this.data.sessionId,
      lat,
      lng
    };

    navLog('updateLocation - 上报位置', payload);

    wx.request({
      url: `${API_BASE}/api/navigation/location`,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: payload,
      success: (resp) => {
        navLog('updateLocation - 响应', resp.data);

        const data = resp.data?.data;
        if (!data) return;

        this.applyNavigationFromServer(data, {});

        navLog('updateLocation - 页面更新成功', {
          currentInstruction: data.current_instruction,
          isOffRoute: data.is_off_route,
          arrived: data.arrived,
          currentStepIndex: data.current_step_index
        });

        if (data.arrived) {
          navLog('updateLocation - 已到达，停止导航');
          this.stopNavigation(true);
        }
      },
      fail: (err) => {
        navLog('updateLocation - 请求失败', err);
      }
    });
  },

  queryNavigationStatus() {
    if (!this.data.sessionId) {
      navLog('queryNavigationStatus - sessionId 为空');
      return;
    }

    navLog('queryNavigationStatus - 请求 status', this.data.sessionId);

    wx.request({
      url: `${API_BASE}/api/navigation/status?session_id=${this.data.sessionId}`,
      method: 'GET',
      success: (resp) => {
        navLog('queryNavigationStatus - 响应', resp.data);

        const data = resp.data?.data;
        if (!data) {
          navLog('queryNavigationStatus - 没有 data');
          return;
        }

        this.applyNavigationFromServer(data, { skipMapCenter: true });

        navLog('queryNavigationStatus - 页面更新成功', {
          currentInstruction: data.current_instruction,
          isOffRoute: data.is_off_route,
          arrived: data.arrived,
          currentStepIndex: data.current_step_index
        });

        if (data.arrived) {
          navLog('queryNavigationStatus - 到达，停止导航');
          this.stopNavigation(true);
        }
      },
      fail: (err) => {
        navLog('queryNavigationStatus - 请求失败', err);
      }
    });
  },

  stopNavigation(silent = false) {
    navLog('stopNavigation - 停止导航', {
      silent,
      sessionId: this.data.sessionId
    });

    this.stopLocationTimer();
    this.stopFallbackPolling();
    this._cancelWebSocketTimers();
    this.closeWebSocket();
    this._lastReportedLat = null;
    this._lastReportedLng = null;

    if (this.data.sessionId) {
      wx.request({
        url: `${API_BASE}/api/navigation/stop`,
        method: 'POST',
        header: { 'content-type': 'application/json' },
        data: { session_id: this.data.sessionId },
        success: (resp) => {
          navLog('stopNavigation - 后端 stop 响应', resp.data);
        },
        fail: (err) => {
          navLog('stopNavigation - 后端 stop 失败', err);
        }
      });
    }

    this.setData({
      isNavigating: false,
      navigationState: '导航已停止',
      routeHint: '你可以重新输入目的地开始导航',
      sessionId: '',
      connectionMode: 'idle',
      connectionHint: '未连接',
      wsConnected: false,
      routeSummaryText: '等待开始导航',
      distanceText: '--',
      currentStepText: '暂无步骤',
      arrivedText: '',
      markers: [],
      polyline: []
    });

    if (!silent) {
      wx.showToast({
        title: '已停止导航',
        icon: 'none'
      });
    }
  },

  backToHome() {
    navLog('backToHome - 返回上一页');
    wx.navigateBack();
  }
});