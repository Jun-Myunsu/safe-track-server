/**
 * 위험 예측 API 컨트롤러
 */
class DangerPredictionController {
  constructor(dangerPredictionService) {
    this.dangerPredictionService = dangerPredictionService;
  }

  /**
   * Express 라우트 설정
   * @param {Express} app - Express 앱 인스턴스
   */
  setupRoutes(app) {
    app.post('/api/danger-analysis', async (req, res) => {
      try {
        const {
          locationHistory,
          currentLocation,
          emergencyFacilities
        } = req.body;

        if (!currentLocation || !currentLocation.lat || !currentLocation.lng) {
          return res.status(400).json({
            error: 'Invalid request: currentLocation is required'
          });
        }

        const result = await this.dangerPredictionService.analyzeDangerZones({
          locationHistory: locationHistory || [],
          currentLocation,
          timestamp: new Date(),
          emergencyFacilities: emergencyFacilities || { hospitals: [], police: [], stations: [] }
        });

        res.json(result);

      } catch (error) {
        console.error('Danger analysis error:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: error.message
        });
      }
    });
  }
}

module.exports = DangerPredictionController;
