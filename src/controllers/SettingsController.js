const Settings = require('../models/Settings');

class SettingsController {
  async getRegistrationStatus(socket) {
    try {
      const isEnabled = await Settings.isRegistrationEnabled();
      socket.emit('registrationStatus', { enabled: isEnabled });
    } catch (error) {
      socket.emit('error', { message: '설정 조회 실패' });
    }
  }

  async toggleRegistration(socket, data) {
    try {
      const { userId } = data;
      
      // msjun만 설정 변경 가능
      if (userId !== 'msjun') {
        socket.emit('error', { message: '권한이 없습니다' });
        return;
      }

      const currentStatus = await Settings.isRegistrationEnabled();
      const newStatus = !currentStatus;
      
      await Settings.setRegistrationEnabled(newStatus);
      
      socket.emit('registrationToggled', { enabled: newStatus });
    } catch (error) {
      socket.emit('error', { message: '설정 변경 실패' });
    }
  }
}

module.exports = SettingsController;
