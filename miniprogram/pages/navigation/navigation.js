// pages/navigation/navigation.js
const DEBUG_NAV = true;
const NAV_SETTINGS_KEY = 'huiVisionNavSettings';
const DEFAULT_NAV_SETTINGS = {
  navUpdateIntervalSec: 2,
  navOffRouteThresholdM: 25,
  navArriveThresholdM: 12,
  navDefaultCity: '济南'
};
// const API_BASE = 'http://10.208.61.154:8000';
const API_BASE = 'http://10.40.77.154:8000';
const WS_BASE = 'ws://36.tcp.cpolar.top:13579';
const NAV_WS_PATH = '/api/navigation/ws';

const quickOptions = [
  { id: 'toilet', label: '卫生间', icon: '🚻' },
  { id: 'subway', label: '地铁', icon: '🚇' },
  { id: 'restaurant', label: '餐厅', icon: '🍽️' },
  { id: 'supermarket', label: '超市', icon: '🛒' }
];

const DEFAULT_LOCATION = { latitude: 36.6684, longitude: 117.1414 };

function navLog(step, data) {
  if (!DEBUG_NAV) return;
  if (typeof data === 'undefined') {
    console.log(`[NAV DEBUG] ${step}`);
    return;
  }
  console.log(`[NAV DEBUG] ${step}`, data);
}

function decodePolyline(polyline) {
  if (!polyline) return [];
  return polyline.split(';').map((item) => {
    const [lng, lat] = item.split(',').map(Number);
    return { latitude: lat, longitude: lng };
  }).filter((pt) => !Number.isNaN(pt.latitude) && !Number.isNaN(pt.longitude));
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
    scale: 16,
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
    });
    navLog(`setMapLocation - ${source}`, { latitude, longitude });
  },

  renderRoute(state) {
    const routeSummary = state.route_summary || {};
    const markers = Array.isArray(state.markers) ? state.markers.map((marker) => ({
      id: marker.id,
      latitude: marker.latitude,
      longitude: marker.longitude,
      width: marker.width || 24,
      height: marker.height || 24,
      iconPath: marker.iconPath,
      callout: marker.title ? {
        content: marker.title,
        display: 'BYCLICK',
        padding: 6,
        borderRadius: 8,
        bgColor: '#ffffff',
        color: '#1f2937'
      } : undefined
    })) : [];

    const polyline = [];
    const routePoints = Array.isArray(state.route_points) ? state.route_points : [];
    if (routePoints.length > 1) {
      polyline.push({
        points: routePoints.map((pt) => ({ latitude: pt.lat, longitude: pt.lng })),
        color: '#1677ff',
        width: 6,
        arrowLine: true,
        borderColor: '#ffffff',
        borderWidth: 2
      });
    }

    const stepText = state.current_instruction || '导航中';
    const summaryText = routeSummary.distance_m ? `路线距离 ${Math.round(routeSummary.distance_m)} 米` : '路线已生成';

    this.setData({
      markers,
      polyline,
      routeSummaryText: summaryText,
      distanceText: typeof state.distance_to_destination_m === 'number' ? `${Math.round(state.distance_to_destination_m)} 米` : '--',
      currentStepText: stepText,
      arrivedText: state.arrived ? '已到达目的地' : ''
    });

    if (state.current_lat && state.current_lng) {
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
              wsConnected: false
            });

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

    navLog('tryConnectWebSocket - 准备连接', {
      sessionId,
      wsUrl: `${WS_BASE}${NAV_WS_PATH}?session_id=${sessionId}`
    });

    this.setData({
      connectionMode: 'ws',
      connectionHint: '正在尝试 WebSocket 连接...',
      wsConnected: false
    });

    this.closeWebSocket();
    const wsUrl = `${WS_BASE}${NAV_WS_PATH}?session_id=${sessionId}`;

    try {
      this.ws = wx.connectSocket({ url: wsUrl });
    } catch (error) {
      navLog('tryConnectWebSocket - wx.connectSocket 直接报错', error);
      this.switchToPolling('WebSocket 创建失败，已切换轮询');
      return;
    }

    this.wsOpenTimeout = setTimeout(() => {
      navLog('tryConnectWebSocket - WebSocket 超时，切换轮询');
      this.switchToPolling('WebSocket 连接超时，已切换轮询');
    }, 5000);

    this.ws.onOpen(() => {
      navLog('WebSocket onOpen - 连接成功');
      if (this.wsOpenTimeout) {
        clearTimeout(this.wsOpenTimeout);
        this.wsOpenTimeout = null;
      }
      this.setData({
        wsConnected: true,
        connectionMode: 'ws',
        connectionHint: 'WebSocket 已连接'
      });
      this.stopFallbackPolling();
    });

    this.ws.onMessage((res) => {
      navLog('WebSocket onMessage - 收到消息', res.data);

      try {
        const msg = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        navLog('WebSocket onMessage - 解析后消息', msg);

        const payload = msg.payload || {};
        if (payload.current_instruction) {
          this.setData({
            routeHint: payload.current_instruction,
            navigationState: payload.arrived ? '已到达目的地' : (payload.is_off_route ? '已偏航' : '导航中')
          });
        }

        if (payload.arrived) {
          navLog('WebSocket onMessage - 已到达目的地');
          this.stopNavigation(true);
        }
      } catch (e) {
        navLog('WebSocket onMessage - 消息解析失败', e);
      }
    });

    this.ws.onError((err) => {
      navLog('WebSocket onError - 连接失败', err);
      if (this.wsOpenTimeout) {
        clearTimeout(this.wsOpenTimeout);
        this.wsOpenTimeout = null;
      }
      this.switchToPolling('WebSocket 连接失败，已切换轮询');
    });

    this.ws.onClose(() => {
      navLog('WebSocket onClose - 连接关闭');
      if (this.wsOpenTimeout) {
        clearTimeout(this.wsOpenTimeout);
        this.wsOpenTimeout = null;
      }
      if (this.data.connectionMode === 'ws' && this.data.isNavigating) {
        this.switchToPolling('WebSocket 已断开，已切换轮询');
      }
      this.setData({ wsConnected: false });
    });
  },

  switchToPolling(hint) {
    navLog('switchToPolling - 切换轮询', hint);
    this.closeWebSocket();
    this.setData({
      connectionMode: 'polling',
      connectionHint: hint || '当前使用轮询模式'
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
    if (this.wsOpenTimeout) {
      clearTimeout(this.wsOpenTimeout);
      this.wsOpenTimeout = null;
    }
    if (this.ws) {
      navLog('closeWebSocket - 关闭WS');
      try {
        this.ws.close();
      } catch (e) {
        navLog('closeWebSocket - 关闭失败', e);
      }
      this.ws = null;
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

        this.setData({
          routeHint: data.current_instruction || this.data.routeHint,
          navigationState: data.arrived ? '已到达目的地' : (data.is_off_route ? '已偏航' : '导航中')
        });
        this.renderRoute(data);

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

        this.setData({
          routeHint: data.current_instruction || this.data.routeHint,
          navigationState: data.arrived ? '已到达目的地' : (data.is_off_route ? '已偏航' : '导航中')
        });
        this.renderRoute(data);

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
    this.closeWebSocket();

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