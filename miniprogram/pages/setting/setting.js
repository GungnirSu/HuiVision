// 设置页面逻辑
Page({
  /**
   * 页面的初始数据
   */
  data: {

  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {

  },

  // 返回上一页
  navigateBack() {
    wx.navigateBack();
  },

  // 打开问答对话播报设置
  openDialogSetting() {
    console.log('打开问答对话播报设置');
    // 这里添加问答对话播报设置的逻辑
  },

  // 打开出行模式设置
  openTravelSetting() {
    console.log('打开出行模式设置');
    // 这里添加出行模式设置的逻辑
  },

  // 打开会视模式设置
  openVisionSetting() {
    console.log('打开会视模式设置');
    // 这里添加会视模式设置的逻辑
  },

  // 打开导航设置
  openNavigationSetting() {
    console.log('打开导航设置');
    // 这里添加导航设置的逻辑
  },

  // 打开音频设置
  openAudioSetting() {
    console.log('打开音频设置');
    // 这里添加音频设置的逻辑
  },

  // 恢复默认设置
  resetSettings() {
    wx.showModal({
      title: '确认恢复默认设置',
      content: '恢复默认设置将重置所有配置项，确定要继续吗？',
      success: function(res) {
        if (res.confirm) {
          console.log('用户确认恢复默认设置');
          // 这里添加恢复默认设置的逻辑
          wx.showToast({
            title: '已恢复默认设置',
            icon: 'success',
            duration: 2000
          });
        }
      }
    });
  }
})