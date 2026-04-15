Page({
  data: {
    // 1. 定义模式列表 (确保有 name 字段)
    modeArray: [
      { id: 'navigation', name: '盲人微观导航' },
      { id: 'culture', name: '沉浸式文化导游' },
      { id: 'repair', name: '智能故障诊断' }
    ],
    modeIndex: 0, // 默认选中第一个
    currentModeName: '盲人微观导航', // 默认显示文字
    guideText: '请对准前方道路或障碍物'
  },

  onLoad: function(options) {
    // 2. 接收上个页面传来的 mode 参数
    if (options.mode) {
      const mode = options.mode;
      // 查找对应的索引
      const index = this.data.modeArray.findIndex(item => item.id === mode);
      if (index !== -1) {
        this.setData({
          modeIndex: index,
          currentModeName: this.data.modeArray[index].name,
          guideText: this.getGuideText(mode) // 更新提示语
        });
      }
    }
  },

  // 3. 监听 Picker 变化
  bindModeChange: function(e) {
    const index = e.detail.value;
    const selectedMode = this.data.modeArray[index];

    this.setData({
      modeIndex: index,
      currentModeName: selectedMode.name,
      guideText: this.getGuideText(selectedMode.id)
    });
  },

  // 辅助函数：根据模式返回提示语
  getGuideText: function(modeId) {
    if (modeId === 'navigation') return '请对准前方道路或障碍物';
    if (modeId === 'culture') return '请对准文物、菜单或景点';
    if (modeId === 'repair') return '请对准故障设备或报错屏幕';
    return '请拍摄照片';
  },

  // 拍照功能
  takePhoto() {
    const ctx = wx.createCameraContext();
    ctx.takePhoto({
      quality: 'high',
      success: (res) => {
        console.log('照片路径:', res.tempImagePath);
        // 联调关键：将照片上传至后端
        wx.uploadFile({
          url: `${API_URL}/api/vision-identify`, // 后端接口路径（兼容返回文本和JSON）
          filePath: res.tempImagePath,
          name: 'image',
          success: (uploadRes) => {
            if (uploadRes.statusCode !== 200) {
              wx.showToast({ title: '识别失败', icon: 'none' });
              return;
            }

            let resultText = '';

            try {
              const parsed = typeof uploadRes.data === 'string' ? JSON.parse(uploadRes.data) : uploadRes.data;
              resultText = parsed.description || parsed.data || JSON.stringify(parsed);
            } catch (error) {
              resultText = typeof uploadRes.data === 'string' ? uploadRes.data : String(uploadRes.data);
            }

            console.log('识别结果：', resultText);

            wx.showModal({
              title: '识别结果',
              content: resultText,
              showCancel: false
            });
          }
        });
      },
      fail: (err) => {
        console.error(err);
        wx.showToast({ title: '拍照失败', icon: 'none' });
      }
    });
  }
});