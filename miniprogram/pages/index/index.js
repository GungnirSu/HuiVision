// 主页面逻辑
Page({
  data: {
    activeMode: "vision", // 默认选中：会视模式
    isRealTimeOpen: false, // 实时分析开关默认关闭
    inputValue: '' // 输入框内容
  },

  // 页面加载
  onLoad() {},

  // 核心：模式切换
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ activeMode: mode });
    
    // 切换模式时自动识别一次（如果实时分析开启则持续）
    if (this.data.isRealTimeOpen) {
      this.autoAnalyze();
    }
  },

  // 实时分析开关
  switchRealTime(e) {
    const isOpen = e.detail.value;
    this.setData({ isRealTimeOpen: isOpen });
    
    if (isOpen) {
      this.autoAnalyze();
    }
  },
  
  // 自动分析（模拟）
  autoAnalyze() {
    console.log('自动分析功能启动');
    // 这里可以添加实时分析的逻辑
  },
  
  // 快速分析
  quickAnalysis() {
    console.log('快速分析');
    // 这里添加快速分析的逻辑
  },
  
  // 打开设置
  openSetting() {
    wx.navigateTo({
      url: '../setting/setting'
    });
  },
  
  // 阅读文字
  readText() {
    console.log('阅读文字');
    // 这里添加阅读文字的逻辑
  },
  
  // 打开导航设置
  openNavigation() {
    console.log('打开导航设置');
    // 这里添加导航设置的逻辑
  },
  
  // 输入框输入
  bindInput(e) {
    this.setData({
      inputValue: e.detail.value
    });
  },
  
  // 发送消息
  sendMessage() {
    const value = this.data.inputValue.trim();
    if (value) {
      console.log('发送消息:', value);
      // 自动调用快速识别
      this.quickAnalysis();
      this.setData({ inputValue: '' });
    }
  },
  
  // 开始语音
  startVoice() {
    console.log('开始语音');
    // 这里添加语音识别的逻辑
  },
  
  // 停止语音
  stopVoice() {
    console.log('停止语音');
    // 这里添加语音识别结束的逻辑
  }
})