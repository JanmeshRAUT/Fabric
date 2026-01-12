import React, { useState, useEffect } from 'react';
import './MainScreen.css';
import './UploadDetection.css';
import './LiveDetection.css';
import ImageUpload from './ImageUpload';
import DetectionHistory from './DetectionHistory';
import ModelManagement from './ModelManagement';
import axios from 'axios';

function MainScreen() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [serverStatus, setServerStatus] = useState('checking');
  const [confidencePct, setConfidencePct] = useState(25);
  const [overlapPct, setOverlapPct] = useState(50);
  const [opacityPct, setOpacityPct] = useState(75);
  const [activeTab, setActiveTab] = useState('upload');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showModelMgmt, setShowModelMgmt] = useState(false);
  const [progress, setProgress] = useState(0);
  const videoRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const streamRef = React.useRef(null);

  const API_URL = 'http://localhost:5000/api/detect';
  const AB_TEST_URL = 'http://localhost:5000/api/detect/ab-test';
  const HEALTH_URL = 'http://localhost:5000/api/health';

  useEffect(() => {
    checkServerHealth();
    // Cleanup camera on unmount
    return () => {
      stopCamera();
    };
  }, []);

  const checkServerHealth = async () => {
    try {
      const response = await axios.get(HEALTH_URL);
      if (response.data.status === 'healthy') {
        setServerStatus('online');
      } else {
        setServerStatus('offline');
      }
    } catch (err) {
      setServerStatus('offline');
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
        audio: false
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.style.display = 'block';
        streamRef.current = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error('Error accessing camera:', err);
      alert('Cannot access camera. Please check permissions.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.style.display = 'none';
    }
    setIsCameraActive(false);
  };

  // Model info panel removed per request

  const handleImageUpload = async (file) => {
    setLoading(true);
    setProgress(0);
    setError(null);
    setResults(null);

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('confidence', (confidencePct / 100));
      formData.append('overlap', (overlapPct / 100));
      formData.append('opacity', (opacityPct / 100));

      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev < 90) return prev + Math.random() * 30;
          return prev;
        });
      }, 200);

      // Call the Flask backend API
      const response = await axios.post(API_URL, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (response.data.success) {
        // Use annotated image if available, otherwise use original
        const imageToShow = response.data.annotated_image || response.data.image;
        
        setResults({
          image: imageToShow,
          detections: response.data.detections,
          total_detections: response.data.total_detections,
          image_size: response.data.image_size,
          confidence_used: response.data.confidence_used
        });
      } else {
        setError(response.data.error || 'Detection failed');
      }

      setLoading(false);
      setTimeout(() => setProgress(0), 500);

    } catch (err) {
      setProgress(0);
      if (err.response) {
        setError(`Server error: ${err.response.data.error || err.response.statusText}`);
      } else if (err.request) {
        setError('Cannot connect to backend server. Make sure Flask is running on http://localhost:5000');
      } else {
        setError('Error processing image. Please try again.');
      }
      setLoading(false);
      console.error('Detection error:', err);
    }
  };

  return (
    <div className="main-screen">
      {/* Modal Overlays */}
      {showHistory && (
        <div className="modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="modal-content large" onClick={(e) => e.stopPropagation()}>
            <DetectionHistory onClose={() => setShowHistory(false)} />
          </div>
        </div>
      )}

      {showModelMgmt && (
        <div className="modal-overlay" onClick={() => setShowModelMgmt(false)}>
          <div className="modal-content large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Model Management</h2>
              <button className="close-btn" onClick={() => setShowModelMgmt(false)}>✕</button>
            </div>
            <ModelManagement />
          </div>
        </div>
      )}

      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="logo-container">
            <div className="logo-icon">🔍</div>
            <div>
              <h1 className="app-title">Fabric Fault Detection</h1>
              <p className="app-subtitle">AI-Powered YOLO Detection System</p>
            </div>
          </div>
        </div>

        <div className="header-center">
          <button 
            className={`tab-button ${activeTab === 'upload' ? 'active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            📤 Upload Detection
          </button>
          <button 
            className={`tab-button ${activeTab === 'live' ? 'active' : ''}`}
            onClick={() => setActiveTab('live')}
          >
            📹 Live Detection
          </button>
          <button 
            className="tab-button secondary"
            onClick={() => setShowHistory(true)}
            title="View detection history"
          >
            📊 History
          </button>
          <button 
            className="tab-button secondary"
            onClick={() => setShowModelMgmt(true)}
            title="Manage models and settings"
          >
            ⚙️ Models
          </button>
        </div>

        <div className="header-right">
          <div className="stats-mini">
            {results && (
              <>
                <div className="stat-mini">
                  <span className="stat-value">{results.total_detections}</span>
                  <span className="stat-label">Detections</span>
                </div>
                <div className="stat-mini">
                  <span className="stat-value">{(results.confidence_used * 100).toFixed(0)}%</span>
                  <span className="stat-label">Confidence</span>
                </div>
              </>
            )}
          </div>
          <div className="server-status">
            <span className={`${serverStatus}`}></span>
            <span className="status-text">
              {serverStatus === 'online' ? '🟢 Online' : 
               serverStatus === 'offline' ? '🔴 Offline' : '🟡 Checking...'}
            </span>
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      {loading && progress > 0 && (
        <div className="progress-bar-container">
          <div className="progress-bar" style={{ width: `${progress}%` }}></div>
        </div>
      )}


      {/* Dashboard Grid: Upload+Adjustment, Detection, Results */}
      {activeTab === 'upload' && (
      <main className="dashboard-grid">
        {/* Upload + Adjustment Panel */}
        <section className="panel-card upload-card">
          <div className="panel-header">
            <h3 className="panel-title">Upload & Adjust</h3>
          </div>
          <div className="panel-body">
            <div className="upload-frame">
              <div className="upload-frame__control">
                <ImageUpload onImageUpload={handleImageUpload} loading={loading} />
              </div>
            </div>
            
            <div className="adjustment-stack">
              <div className="slider-block">
                <label className="control-label">Confidence:</label>
                <div className="value-display">{confidencePct}%</div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={confidencePct}
                  onChange={(e) => setConfidencePct(parseInt(e.target.value))}
                  className="ui-slider"
                  disabled={loading}
                />
                <div className="slider-scale"><span>0%</span><span>100%</span></div>
              </div>

              <div className="slider-block">
                <label className="control-label">Overlap:</label>
                <div className="value-display">{overlapPct}%</div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={overlapPct}
                  onChange={(e) => setOverlapPct(parseInt(e.target.value))}
                  className="ui-slider"
                  disabled={loading}
                />
                <div className="slider-scale"><span>0%</span><span>100%</span></div>
              </div>

              <div className="slider-block">
                <label className="control-label">Opacity:</label>
                <div className="value-display">{opacityPct}%</div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={opacityPct}
                  onChange={(e) => setOpacityPct(parseInt(e.target.value))}
                  className="ui-slider"
                  disabled={loading}
                />
                <div className="slider-scale"><span>0%</span><span>100%</span></div>
              </div>
            </div>
          </div>
        </section>

        {/* Detection Panel */}
        <section className="panel-card detection-card">
          <div className="panel-header">
            <h3 className="panel-title">Detection</h3>
          </div>
          <div className="panel-body">
            {error && (
              <div className="error-message">
                <span className="error-icon">⚠️</span>
                {error}
              </div>
            )}
            {loading && (
              <div className="loading-state">
                <div className="loading-content">
                  <div className="spinner"></div>
                  <p className="loading-text">Analyzing with YOLO...</p>
                  <div className="loading-bar">
                    <div className="loading-fill" style={{ width: `${progress}%` }}></div>
                  </div>
                  <p className="loading-percent">{Math.round(progress)}%</p>
                </div>
              </div>
            )}
            {results && !loading && (
              <img src={results.image} alt="Detection view" className="detected-image" />
            )}
            {!results && !loading && !error && (
              <div className="placeholder-state">
                <div className="placeholder-icon">🖼️</div>
                <h3>Upload an Image to Start</h3>
                <p>Upload a fabric image to detect defects using YOLO</p>
              </div>
            )}
          </div>
        </section>

        {/* Results Panel */}
        <section className="panel-card results-card">
          <div className="panel-header">
            <h3 className="panel-title">Results</h3>
          </div>
          <div className="panel-body">
            {results && !loading ? (
              <>
                <div className="detections-list">
                  <div className="detections-header">
                    <span className="detections-count">Detected Faults ({results.detections.length})</span>
                  </div>
                  {results.detections.length === 0 ? (
                    <div className="no-detections">
                      <p>✓ No faults detected - Fabric appears to be in good condition!</p>
                    </div>
                  ) : (
                    results.detections.map((d, idx) => (
                      <div key={idx} className="detection-row">
                        <span className="detection-class">{d.class}</span>
                        <span className="detection-confidence">{(d.confidence * 100).toFixed(1)}%</span>
                        <div className="confidence-bar-container">
                          <div className="confidence-bar" style={{ width: `${d.confidence * 100}%` }}></div>
                        </div>
                      </div>
                    ))
                    )}
                </div>

                <div className="summary-grid">
                  <div className="summary-card">
                    <div className="summary-label">Total Faults</div>
                    <div className="summary-value">{results.detections.length}</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-label">Fault Types</div>
                    <div className="summary-value">{results.detections.length > 0 ? [...new Set(results.detections.map(d => d.class))].length : 0}</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-label">Avg Confidence</div>
                    <div className="summary-value">{results.detections.length > 0 ? (results.detections.reduce((sum, d) => sum + d.confidence, 0) / results.detections.length * 100).toFixed(1) + '%' : 'N/A'}</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="placeholder-state">
                <div className="placeholder-icon">📊</div>
                <h3>No Results</h3>
                <p>Upload an image and run detection to see results.</p>
              </div>
            )}
          </div>
        </section>
      </main>
      )}

      {/* Live Detection Tab */}
      {activeTab === 'live' && (
      <main className="dashboard-grid">
        {/* Camera Controls Panel */}
        <section className="panel-card upload-card">
          <div className="panel-header">
            <h3 className="panel-title">Camera & Settings</h3>
          </div>
          <div className="panel-body">
            <div className="camera-controls">
              <button 
                className="camera-button"
                onClick={startCamera}
                disabled={isCameraActive}
              >
                📹 Start Camera
              </button>
              <button 
                className="camera-button secondary"
                onClick={stopCamera}
                disabled={!isCameraActive}
              >
                ⏹️ Stop Camera
              </button>
            </div>

            <div className="adjustment-stack">
              <div className="slider-block">
                <label className="control-label">Confidence:</label>
                <div className="value-display">{confidencePct}%</div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={confidencePct}
                  onChange={(e) => setConfidencePct(parseInt(e.target.value))}
                  className="ui-slider"
                  disabled={loading}
                />
                <div className="slider-scale"><span>0%</span><span>100%</span></div>
              </div>

              <div className="slider-block">
                <label className="control-label">Overlap:</label>
                <div className="value-display">{overlapPct}%</div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={overlapPct}
                  onChange={(e) => setOverlapPct(parseInt(e.target.value))}
                  className="ui-slider"
                  disabled={loading}
                />
                <div className="slider-scale"><span>0%</span><span>100%</span></div>
              </div>

              <div className="slider-block">
                <label className="control-label">Opacity:</label>
                <div className="value-display">{opacityPct}%</div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={opacityPct}
                  onChange={(e) => setOpacityPct(parseInt(e.target.value))}
                  className="ui-slider"
                  disabled={loading}
                />
                <div className="slider-scale"><span>0%</span><span>100%</span></div>
              </div>
            </div>
          </div>
        </section>

        {/* Live Detection Panel */}
        <section className="panel-card detection-card">
          <div className="panel-header">
            <h3 className="panel-title">Live Feed</h3>
          </div>
          <div className="panel-body">
            <div className="live-feed-container">
              <div className="placeholder-state">
                <div className="placeholder-icon">📹</div>
                <h3>Camera Inactive</h3>
                <p>Click "Start Camera" to begin live detection</p>
              </div>
              <video 
                ref={videoRef} 
                className="live-video"
                style={{ display: 'none' }}
                autoPlay
                playsInline
              />
              <canvas 
                ref={canvasRef}
                className="detection-canvas"
                style={{ display: 'none' }}
              />
            </div>
          </div>
        </section>
        {/* Live Results Panel */}
        <section className="panel-card results-card">
          <div className="panel-header">
            <h3 className="panel-title">Live Results</h3>
          </div>
          <div className="panel-body">
            <div className="placeholder-state">
              <div className="placeholder-icon">📊</div>
              <h3>No Live Feed</h3>
              <p>Start camera to see live detection results</p>
            </div>
          </div>
        </section>
      </main>
      )}

      {/* Footer */}
      <footer className="app-footer">
        <p>Powered by YOLOv8 • React • Flask</p>
      </footer>
    </div>
  );
}

export default MainScreen;
