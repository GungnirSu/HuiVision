// 设置页面逻辑
const NAV_SETTINGS_KEY = 'huiVisionNavSettings';
const DEFAULT_NAV_SETTINGS = {
  navUpdateIntervalSec: 2,
  navOffRouteThresholdM: 25,
  navArriveThresholdM: 12,
  navDefaultCity: '济南'
};

Page({
  data: {
    navUpdateIntervalSec: 2,
    navOffRouteThresholdM: 25,
    navArriveThresholdM: 12,
    navDefaultCity: '济南'
  },

  onLoad() {
    this.loadNavSettings();
  },

  loadNavSettings() {
    const saved = wx.getStorageSync(NAV_SETTINGS_KEY) || {};
    const merged = { ...DEFAULT_NAV_SETTINGS, ...saved };
    this.setData(merged);
  },

  saveNavSettings() {
    const settings = {
      navUpdateIntervalSec: Number(this.data.navUpdateIntervalSec),
      navOffRouteThresholdM: Number(this.data.navOffRouteThresholdM),
      navArriveThresholdM: Number(this.data.navArriveThresholdM),
      navDefaultCity: this.data.navDefaultCity || DEFAULT_NAV_SETTINGS.navDefaultCity
    };
    wx.setStorageSync(NAV_SETTINGS_KEY, settings);
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  resetNavSettings() {
    wx.setStorageSync(NAV_SETTINGS_KEY, DEFAULT_NAV_SETTINGS);
    this.setData(DEFAULT_NAV_SETTINGS);
    wx.showToast({ title: '已恢复默认', icon: 'success' });
  },

  onIntervalChange(e) {
    const value = Number(e.detail.value);
    const map = [4, 2, 1];
    this.setData({ navUpdateIntervalSec: map[value] });
  },

  onOffRouteChange(e) {
    const value = Number(e.detail.value);
    const map = [35, 25, 15];
    this.setData({ navOffRouteThresholdM: map[value] });
  },

  onArriveChange(e) {
    const value = Number(e.detail.value);
    const map = [15, 12, 8];
    this.setData({ navArriveThresholdM: map[value] });
  },

  onCityInput(e) {
    this.setData({ navDefaultCity: e.detail.value });
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