const { API_URL } = require('../../envList.js'); // 引入地址

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
  // 流程是“创建相机控制器 → 拍照 → 成功就拿到图片路径并上传分析，失败就提示用户”。
  quickAnalysis() {
    const ctx = wx.createCameraContext();
    ctx.takePhoto({
      quality: 'normal',
      success: (res) => {
        const tempFilePath = res.tempImagePath;
        this.uploadAndAnalyze(tempFilePath); // 调用上传函数
      },
      fail: () => {
        wx.showToast({ title: '拍照失败', icon: 'none' });
      }
    });
  },

  // 发送图片到后端进行 AI 分析
  uploadAndAnalyze(filePath) {
    wx.showLoading({ title: '正在识别...' });
    
    wx.uploadFile({
      url: `${API_URL}/v1/vision/analyze`, // 后端接口路径
      filePath: filePath,
      name: 'file', // 后端接收文件的字段名
      formData: {
        'mode': this.data.activeMode // 传入当前模式：出行或会视
      },
      success: (res) => {
        if (res.statusCode !== 200) {
        wx.showToast({ title: '识别失败', icon: 'none' });
        return;
        }

        let resultText = '';

        try {
        const parsed = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        resultText = parsed.description || parsed.data || JSON.stringify(parsed);
        } catch (error) {
        resultText = typeof res.data === 'string' ? res.data : String(res.data);
        }

        console.log('分析结果：', resultText);

        wx.showModal({
        title: '识别结果',
        content: resultText,
        showCancel: false
        });
      },
      fail: (err) => {
        console.error('联调失败：', err);
        wx.showToast({ title: '网络请求失败', icon: 'none' });
      },
      complete: () => {
        wx.hideLoading();
      }
    });
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
    if (!value) return;
    wx.request({
      url: `${API_URL}/api/chat`, // 后端接口路径
      method: 'POST',
      data: { query: value, mode: this.data.activeMode },
      success: (res) => {
        // 处理对话结果
        this.setData({ inputValue: '' });
      }
    });
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