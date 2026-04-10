const { API_URL } = require("../../envList");

const REALTIME_INTERVAL = 2200; // 实时识别频率（毫秒）
const MIN_SPEAK_INTERVAL = 1500; // 最短播报间隔，避免过于频繁

//需要后端提供的接口：
// /api/travel/analyze
// /api/navigation/route
// /api/navigation/instruction
// /api/speech/stt
// /api/speech/tts
// /api/travel/parse-command

Page({
  data: {
    // 运行状态
    initialized: false,
    isRealtimeRunning: false,
    isNavigating: false,
    isListening: false,
    isKeyboardMode: false,
    isLoading: false,

    // 导航与识别配置
    navProvider: "amap", // amap | baidu | none
    aiBroadcastMode: "fusion", // fusion | obstacle_only | road_only
    warningDistance: 2.5, // 单位米
    sensitivity: "standard", // low | standard | high
    radarEnabled: true,

    // 导航输入
    destinationText: "",
    commandText: "",
    routeId: "",
    navInstruction: "",
    nextTurnDistance: 0,

    // 位置与识别结果
    location: null,
    lastQuickSummary: "",
    lastSceneType: "",
    lastObstacleLevel: "normal", // normal | warning | danger
    lastSpokenText: "",
    lastSpokenAt: 0,

    // 日志区（可映射到滚动播报区）
    logs: [
      { time: Date.now(), text: "出行模式已准备，点击开始实时引导或按住说话输入指令。" }
    ]
  },

  onLoad() {
    this._realtimeTimer = null;
    this._speaking = false;
    this._speakQueue = [];
    this._cameraBusy = false;
    this._destroyed = false;

    this.cameraContext = wx.createCameraContext();
    this.recorderManager = wx.getRecorderManager();
    this.audioPlayer = wx.createInnerAudioContext();

    this.bindRecorderEvents();
    this.bindAudioEvents();
    this.initLocation();
    this.setData({ initialized: true });
  },

  onShow() {
    // 页面显示时可以做轻量状态恢复
  },

  onHide() {
    this.stopRealtimeGuide();
  },

  onUnload() {
    this._destroyed = true;
    this.stopRealtimeGuide();
    this.stopLocation();
    this.safeDestroyAudio();
  },

  // ----------------------------
  // 初始化与基础能力
  // ----------------------------
  bindRecorderEvents() {
    if (!this.recorderManager) return;

    this.recorderManager.onStart(() => {
      this.setData({ isListening: true });
      this.pushLog("开始录音，请说出指令。");
    });

    this.recorderManager.onStop(async (res) => {
      this.setData({ isListening: false });
      if (!res || !res.tempFilePath) {
        this.pushLog("录音失败，请重试。");
        return;
      }
      this.pushLog("语音识别中...");
      try {
        const text = await this.uploadVoiceForSTT(res.tempFilePath);
        if (!text) {
          this.pushLog("未识别到有效语音。");
          return;
        }
        this.pushLog("识别结果：" + text);
        this.handleCommandText(text, true);
      } catch (err) {
        this.pushLog("语音识别失败：" + this.getErrorMsg(err));
      }
    });

    this.recorderManager.onError((err) => {
      this.setData({ isListening: false });
      this.pushLog("录音异常：" + this.getErrorMsg(err));
    });
  },

  bindAudioEvents() {
    if (!this.audioPlayer) return;

    this.audioPlayer.onEnded(() => {
      this._speaking = false;
      this.playNextSpeech();
    });

    this.audioPlayer.onError(() => {
      this._speaking = false;
      this.playNextSpeech();
    });
  },

  safeDestroyAudio() {
    try {
      if (this.audioPlayer) {
        this.audioPlayer.stop();
        this.audioPlayer.destroy();
      }
    } catch (e) {
      // 忽略销毁异常
    }
  },

  initLocation() {
    wx.getLocation({
      type: "gcj02",
      success: (res) => {
        this.setData({
          location: {
            latitude: res.latitude,
            longitude: res.longitude,
            speed: res.speed || 0,
            accuracy: res.accuracy || 0
          }
        });
      },
      fail: () => {
        this.pushLog("定位权限未开启，将使用无定位模式进行识别。");
      }
    });

    // 持续定位用于导航融合
    wx.startLocationUpdate({
      success: () => {
        wx.onLocationChange((res) => {
          if (this._destroyed) return;
          this.setData({
            location: {
              latitude: res.latitude,
              longitude: res.longitude,
              speed: res.speed || 0,
              accuracy: res.accuracy || 0
            }
          });
        });
      },
      fail: () => {
        this.pushLog("无法开启持续定位，导航融合能力受限。");
      }
    });
  },

  stopLocation() {
    try {
      wx.stopLocationUpdate();
    } catch (e) {
      // 忽略
    }
  },

  // ----------------------------
  // 交互：导航输入与参数设置
  // ----------------------------
  onInputDestination(e) {
    this.setData({ destinationText: (e.detail && e.detail.value) || "" });
  },

  onInputCommand(e) {
    this.setData({ commandText: (e.detail && e.detail.value) || "" });
  },

  onToggleKeyboard() {
    this.setData({ isKeyboardMode: !this.data.isKeyboardMode });
  },

  onChangeNavProvider(e) {
    const value = (e.detail && e.detail.value) || "amap";
    this.setData({ navProvider: value });
    this.pushLog("导航服务已切换为：" + value);
  },

  onChangeWarningDistance(e) {
    const value = Number((e.detail && e.detail.value) || 2.5);
    const fixed = isNaN(value) ? 2.5 : value;
    this.setData({ warningDistance: fixed });
    this.pushLog("预警距离已调整为 " + fixed + " 米");
  },

  onSwitchRadar(e) {
    const checked = !!(e.detail && e.detail.value);
    this.setData({ radarEnabled: checked });
    this.pushLog("雷达提示已" + (checked ? "开启" : "关闭"));
  },

  async onSetNavigation() {
    const dest = (this.data.destinationText || "").trim();
    if (!dest) {
      this.safeSpeak("请输入目的地，比如：导航到公司。", "warning");
      return;
    }

    this.setData({ isLoading: true });
    try {
      const routeResp = await this.requestJSON("/api/navigation/route", {
        provider: this.data.navProvider,
        destination: dest,
        currentLocation: this.data.location
      });

      const routeId = (routeResp && routeResp.routeId) || "";
      const firstInstruction = (routeResp && routeResp.firstInstruction) || "路线已规划，开始导航。";

      this.setData({
        isNavigating: true,
        routeId: routeId,
        navInstruction: firstInstruction
      });

      this.pushLog("导航已开始：目的地 " + dest);
      this.safeSpeak("导航已开始。" + firstInstruction, "normal");
    } catch (err) {
      this.pushLog("导航设置失败：" + this.getErrorMsg(err));
      this.safeSpeak("导航设置失败，请稍后重试。", "warning");
    } finally {
      this.setData({ isLoading: false });
    }
  },

  async onStopNavigation() {
    this.setData({
      isNavigating: false,
      routeId: "",
      navInstruction: "",
      nextTurnDistance: 0
    });
    this.pushLog("导航已停止。");
    this.safeSpeak("已停止导航。", "normal");
  },

  // ----------------------------
  // 核心：实时AI出行引导
  // ----------------------------
  async onStartRealtimeGuide() {
    if (this.data.isRealtimeRunning) return;

    this.setData({ isRealtimeRunning: true });
    this.pushLog("实时出行引导已开启。");
    this.safeSpeak("实时出行引导已开启。", "normal");

    // 立即执行一次，减少等待
    this.analyzeCurrentScene("realtime");

    this._realtimeTimer = setInterval(() => {
      this.analyzeCurrentScene("realtime");
    }, REALTIME_INTERVAL);
  },

  onStopRealtimeGuide() {
    this.stopRealtimeGuide();
    this.pushLog("实时出行引导已停止。");
    this.safeSpeak("已停止实时引导。", "normal");
  },

  stopRealtimeGuide() {
    if (this._realtimeTimer) {
      clearInterval(this._realtimeTimer);
      this._realtimeTimer = null;
    }
    if (this.data.isRealtimeRunning) {
      this.setData({ isRealtimeRunning: false });
    }
  },

  async onQuickAnalyze() {
    this.pushLog("正在快速分析当前场景...");
    await this.analyzeCurrentScene("quick");
  },

  async analyzeCurrentScene(mode) {
    if (this._cameraBusy) return;
    this._cameraBusy = true;

    try {
      const photoPath = await this.capturePhoto();
      if (!photoPath) throw new Error("拍照失败");

      const navInfo = await this.getLatestNavigationInstruction();
      const payload = {
        mode: mode, // quick | realtime
        aiBroadcastMode: this.data.aiBroadcastMode,
        warningDistance: this.data.warningDistance,
        sensitivity: this.data.sensitivity,
        radarEnabled: this.data.radarEnabled,
        navigation: navInfo,
        location: this.data.location
      };

      const result = await this.uploadImageForGuide(photoPath, payload);
      this.consumeGuideResult(result, mode);
    } catch (err) {
      this.pushLog("场景分析失败：" + this.getErrorMsg(err));
    } finally {
      this._cameraBusy = false;
    }
  },

  capturePhoto() {
    return new Promise((resolve, reject) => {
      if (!this.cameraContext) {
        reject(new Error("相机上下文不存在"));
        return;
      }
      this.cameraContext.takePhoto({
        quality: "low",
        success: (res) => resolve(res.tempImagePath),
        fail: reject
      });
    });
  },

  async getLatestNavigationInstruction() {
    if (!this.data.isNavigating || !this.data.routeId) {
      return {
        enabled: false,
        instruction: "",
        distanceToTurn: 0
      };
    }

    try {
      const resp = await this.requestJSON("/api/navigation/instruction", {
        provider: this.data.navProvider,
        routeId: this.data.routeId,
        location: this.data.location
      });

      const instruction = (resp && resp.instruction) || "";
      const distance = Number((resp && resp.distanceToTurn) || 0);

      if (instruction) {
        this.setData({
          navInstruction: instruction,
          nextTurnDistance: distance
        });
      }

      return {
        enabled: true,
        instruction: instruction,
        distanceToTurn: distance
      };
    } catch (err) {
      return {
        enabled: true,
        instruction: this.data.navInstruction || "",
        distanceToTurn: this.data.nextTurnDistance || 0
      };
    }
  },

  consumeGuideResult(result, mode) {
    if (!result) return;

    const quickSummary = result.quickSummary || "";
    const obstacleText = result.obstacleAlert || "";
    const roadText = result.roadCondition || "";
    const navFusionText = result.navigationFusion || "";
    const dangerLevel = result.level || "normal";

    this.setData({
      lastQuickSummary: quickSummary,
      lastSceneType: result.sceneType || "",
      lastObstacleLevel: dangerLevel
    });

    let speakText = "";
    if (mode === "quick") {
      speakText = quickSummary || "当前环境安全，可继续前进。";
      this.pushLog("快速分析：" + speakText);
      this.safeSpeak(speakText, dangerLevel);
      return;
    }

    // 实时模式融合播报策略
    if (this.data.aiBroadcastMode === "obstacle_only") {
      speakText = obstacleText || "未发现明显障碍物。";
    } else if (this.data.aiBroadcastMode === "road_only") {
      speakText = roadText || "路况正常。";
    } else {
      const parts = [];
      if (navFusionText) parts.push(navFusionText);
      else if (this.data.navInstruction) parts.push(this.data.navInstruction);
      if (obstacleText) parts.push(obstacleText);
      if (roadText) parts.push(roadText);
      speakText = parts.join("，");
      if (!speakText) {
        speakText = "环境稳定，可继续前行。";
      }
    }

    this.pushLog("实时引导：" + speakText);
    this.safeSpeak(speakText, dangerLevel);
  },

  // ----------------------------
  // 语音输入与文字输入
  // ----------------------------
  onHoldToTalkStart() {
    if (!this.recorderManager) return;

    this.recorderManager.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: "mp3",
      frameSize: 50
    });
  },

  onHoldToTalkEnd() {
    if (!this.recorderManager) return;
    this.recorderManager.stop();
  },

  onSubmitTextCommand() {
    const text = (this.data.commandText || "").trim();
    if (!text) {
      this.safeSpeak("请输入指令内容。", "warning");
      return;
    }
    this.handleCommandText(text, false);
  },

  async handleCommandText(text, fromVoice) {
    const source = fromVoice ? "语音" : "文字";
    this.pushLog(source + "指令：" + text);

    // 先做本地高频命令解析，降低延迟
    const localHandled = this.tryHandleCommandLocally(text);
    if (localHandled) return;

    // 再走大模型命令理解
    try {
      const parsed = await this.requestJSON("/api/travel/parse-command", {
        text: text,
        location: this.data.location,
        status: {
          isRealtimeRunning: this.data.isRealtimeRunning,
          isNavigating: this.data.isNavigating,
          warningDistance: this.data.warningDistance
        }
      });

      await this.executeParsedCommand(parsed);
    } catch (err) {
      this.pushLog("指令解析失败：" + this.getErrorMsg(err));
      this.safeSpeak("我没有听清这个指令，请再说一遍。", "warning");
    }
  },

  tryHandleCommandLocally(text) {
    const raw = (text || "").trim();
    if (!raw) return false;

    if (raw.indexOf("快速分析") >= 0 || raw.indexOf("看看前方") >= 0) {
      this.onQuickAnalyze();
      return true;
    }

    if (raw.indexOf("开始实时") >= 0 || raw.indexOf("开启实时") >= 0) {
      this.onStartRealtimeGuide();
      return true;
    }

    if (raw.indexOf("停止实时") >= 0 || raw.indexOf("关闭实时") >= 0) {
      this.onStopRealtimeGuide();
      return true;
    }

    if (raw.indexOf("停止导航") >= 0 || raw.indexOf("结束导航") >= 0) {
      this.onStopNavigation();
      return true;
    }

    const navMatch = raw.match(/导航到(.+)/);
    if (navMatch && navMatch[1]) {
      this.setData({ destinationText: navMatch[1].trim() });
      this.onSetNavigation();
      return true;
    }

    const disMatch = raw.match(/预警距离(\\d+(\\.\\d+)?)米/);
    if (disMatch && disMatch[1]) {
      const distance = Number(disMatch[1]);
      if (!isNaN(distance)) {
        this.setData({ warningDistance: distance });
        this.safeSpeak("预警距离已调整为" + distance + "米。", "normal");
        this.pushLog("预警距离已调整为 " + distance + " 米");
        return true;
      }
    }

    return false;
  },

  async executeParsedCommand(parsed) {
    if (!parsed) {
      this.safeSpeak("暂未识别到可执行指令。", "warning");
      return;
    }

    const action = parsed.action || "";
    const params = parsed.params || {};

    if (action === "start_navigation") {
      const dest = params.destination || "";
      if (dest) this.setData({ destinationText: dest });
      await this.onSetNavigation();
      return;
    }

    if (action === "stop_navigation") {
      await this.onStopNavigation();
      return;
    }

    if (action === "start_realtime") {
      await this.onStartRealtimeGuide();
      return;
    }

    if (action === "stop_realtime") {
      this.onStopRealtimeGuide();
      return;
    }

    if (action === "set_warning_distance") {
      const d = Number(params.distance);
      if (!isNaN(d)) {
        this.setData({ warningDistance: d });
        this.safeSpeak("预警距离已调整为" + d + "米。", "normal");
        this.pushLog("预警距离已调整为 " + d + " 米");
      }
      return;
    }

    if (action === "quick_analyze") {
      await this.onQuickAnalyze();
      return;
    }

    if (action === "switch_provider") {
      const provider = params.provider || "amap";
      this.setData({ navProvider: provider });
      this.safeSpeak("导航服务已切换。", "normal");
      return;
    }

    this.safeSpeak(parsed.reply || "我还不能执行这个指令。", "warning");
  },

  // ----------------------------
  // 播报与日志
  // ----------------------------
  safeSpeak(text, level) {
    if (!text) return;

    const now = Date.now();
    const lastAt = this.data.lastSpokenAt || 0;
    const lastText = this.data.lastSpokenText || "";

    // 去重与频率控制
    if (text === lastText && now - lastAt < MIN_SPEAK_INTERVAL) return;

    this.setData({
      lastSpokenText: text,
      lastSpokenAt: now
    });

    if (level === "danger") {
      wx.vibrateLong();
    } else if (level === "warning" && this.data.radarEnabled) {
      wx.vibrateShort();
    }

    this.enqueueSpeech(text);
  },

  enqueueSpeech(text) {
    this._speakQueue.push(text);
    this.playNextSpeech();
  },

  async playNextSpeech() {
    if (this._speaking) return;
    if (!this._speakQueue.length) return;

    const text = this._speakQueue.shift();
    this._speaking = true;

    try {
      const tts = await this.requestJSON("/api/speech/tts", {
        text: text,
        speed: 1.0,
        voice: "default"
      });

      const audioUrl = (tts && tts.audioUrl) || "";
      if (audioUrl && this.audioPlayer) {
        this.audioPlayer.src = audioUrl;
        this.audioPlayer.play();
      } else {
        // 无音频时降级为文字提示
        wx.showToast({
          title: text.length > 8 ? text.slice(0, 8) + "..." : text,
          icon: "none",
          duration: 1200
        });
        this._speaking = false;
        this.playNextSpeech();
      }
    } catch (err) {
      wx.showToast({
        title: text.length > 8 ? text.slice(0, 8) + "..." : text,
        icon: "none",
        duration: 1200
      });
      this._speaking = false;
      this.playNextSpeech();
    }
  },

  pushLog(text) {
    const list = this.data.logs || [];
    const next = list.concat([{ time: Date.now(), text: text }]).slice(-30);
    this.setData({ logs: next });
  },

  // ----------------------------
  // 网络层（统一封装）
  // ----------------------------
  requestJSON(path, data) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: API_URL + path,
        method: "POST",
        timeout: 15000,
        header: {
          "content-type": "application/json"
        },
        data: data || {},
        success: (res) => {
          const code = res.statusCode;
          if (code >= 200 && code < 300) {
            resolve(res.data || {});
          } else {
            reject(new Error("HTTP " + code));
          }
        },
        fail: reject
      });
    });
  },

  uploadImageForGuide(filePath, payload) {
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: API_URL + "/api/travel/analyze",
        filePath: filePath,
        name: "image",
        timeout: 20000,
        formData: {
          payload: JSON.stringify(payload || {})
        },
        success: (res) => {
          if (!res || !res.data) {
            reject(new Error("空响应"));
            return;
          }
          try {
            const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
            resolve(data || {});
          } catch (e) {
            reject(new Error("解析响应失败"));
          }
        },
        fail: reject
      });
    });
  },

  uploadVoiceForSTT(tempFilePath) {
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: API_URL + "/api/speech/stt",
        filePath: tempFilePath,
        name: "audio",
        timeout: 20000,
        success: (res) => {
          try {
            const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
            resolve((data && data.text) || "");
          } catch (e) {
            reject(new Error("语音识别返回格式错误"));
          }
        },
        fail: reject
      });
    });
  },

  getErrorMsg(err) {
    if (!err) return "未知错误";
    if (typeof err === "string") return err;
    if (err.errMsg) return err.errMsg;
    if (err.message) return err.message;
    return "请求失败";
  }
});