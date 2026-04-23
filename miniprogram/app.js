// app.js
App({
  globalData: {
    obstacleMonitorRunning: false,
    obstacleMonitorTimer: null,
    lastObstacleReport: ''
  },

  startObstacleMonitor() {
    if (this.globalData.obstacleMonitorTimer) return;

    this.globalData.obstacleMonitorRunning = true;
    this.globalData.obstacleMonitorTimer = setInterval(() => {
      const report = `障碍物检测运行中 ${new Date().toLocaleTimeString()}`;
      this.globalData.lastObstacleReport = report;
      console.log(report);
    }, 3000);
  },

  stopObstacleMonitor() {
    if (this.globalData.obstacleMonitorTimer) {
      clearInterval(this.globalData.obstacleMonitorTimer);
      this.globalData.obstacleMonitorTimer = null;
    }
    this.globalData.obstacleMonitorRunning = false;
  }
});
