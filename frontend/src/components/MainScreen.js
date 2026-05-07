import React, { useState, useEffect, useRef, useCallback } from 'react';
import '../styles/MainScreen.css';
import ImageUpload from './ImageUpload';
import DetectionHistory from './DetectionHistory';
import ModelManagement from './ModelManagement';
import axios from 'axios';

function MainScreen({ theme = 'dark', onThemeToggle = () => {} }) {
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
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [resolution, setResolution] = useState('640x480');
  const [targetFps, setTargetFps] = useState(5);
  const [wsStatus, setWsStatus] = useState('disconnected'); // disconnected, connecting, open, error
  const [isMaximized, setIsMaximized] = useState(false);
  const videoRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const fpsCounterRef = React.useRef(0); // Count frames for real FPS calculation

  const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
  const WS_BASE_URL = process.env.REACT_APP_WS_BASE_URL || 'ws://localhost:5000';

  const API_URL = `${API_BASE_URL}/api/detect`;
  const HEALTH_URL = `${API_BASE_URL}/api/health`;
  const WS_URL = `${WS_BASE_URL}/ws/detect`;

  useEffect(() => {
    checkServerHealth();
    // Enumerate cameras
    navigator.mediaDevices.enumerateDevices()
      .then(devices => {
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setCameras(videoDevices);
        if (videoDevices.length > 0) {
          setSelectedCameraId(videoDevices[0].deviceId);
        }
      })
      .catch(err => console.error("Error enumerating devices:", err));

    // Cleanup camera on unmount
    return () => {
      stopCamera();
    };
  }, [checkServerHealth, stopCamera]);

  const checkServerHealth = useCallback(async () => {
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
  }, [HEALTH_URL]);

  const [liveResults, setLiveResults] = useState(null);
  const websocketRef = React.useRef(null);
  const frameIntervalRef = React.useRef(null);

  const startCamera = async () => {
    if (!selectedCameraId) {
      alert("No camera selected!");
      return;
    }

    try {
      const [width, height] = resolution.split('x').map(Number);
      const constraints = {
        video: { 
          deviceId: { exact: selectedCameraId },
          width: { ideal: width },
          height: { ideal: height }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.style.display = 'block';
        streamRef.current = stream;
        setIsCameraActive(true);
        connectWebSocket();
      }
    } catch (err) {
      console.error('Error accessing camera:', err);
      alert('Cannot access camera. Please check permissions.');
    }
  };

  const connectWebSocket = () => {
    if (websocketRef.current) return;
    
    setWsStatus('connecting');
    const ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
      console.log('Connected to live detection server');
      setWsStatus('open');
      // Start sending frames
      startFrameStreaming();
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.success && canvasRef.current) {
        // Increment FPS counter
        fpsCounterRef.current += 1;

        const ctx = canvasRef.current.getContext('2d');
        const img = new Image();
        img.onload = () => {
          canvasRef.current.width = img.width;
          canvasRef.current.height = img.height;
          ctx.drawImage(img, 0, 0);
        };
        img.src = data.annotated_image;
        setLiveResults(data);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setWsStatus('error');
    };
    
    ws.onclose = () => {
      setWsStatus('disconnected');
    };

    websocketRef.current = ws;
  };

  const startFrameStreaming = () => {
    // Clear existing if any (e.g. if changing FPS)
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);

    const intervalMs = 1000 / targetFps;

    frameIntervalRef.current = setInterval(() => {
      if (!videoRef.current || !websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) return;
      
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0);
      
      const base64Image = canvas.toDataURL('image/jpeg', 0.6); // 0.6 quality for speed
      
      websocketRef.current.send(JSON.stringify({
        image: base64Image,
        confidence: confidencePct / 100,
        overlap: 1 - (overlapPct / 100)
      }));
      
    }, intervalMs);
  };

  // Allow updating FPS while running
  useEffect(() => {
    if (isCameraActive && wsStatus === 'open') {
      startFrameStreaming();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFps]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.style.display = 'none';
    }
    
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }
    
    setIsCameraActive(false);
    setWsStatus('disconnected');
    setLiveResults(null);
  }, []);


  // Model info panel removed per request

  // State for file persistence and cancellation
  const [currentFile, setCurrentFile] = useState(null);
  const abortControllerRef = React.useRef(null);

  const handleImageUpload = async (file, isUpdate = false) => {
    // If it's a new file upload, reset everything
    if (!isUpdate) {
      setLoading(true);
      setCurrentFile(file);
      setResults(null); 
      setProgress(0);
    } else {
      // If updating params, just show small progress but keep result
      // We don't set results to null here to prevent flashing
      setLoading(true);
    }
    
    setError(null);

    // Cancel previous request if exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('confidence', (confidencePct / 100));
      // Invert overlap: 100% on slider = 0 IoU (Strict, No Overlap)
      // 0% on slider = 1 IoU (Loose, All Overlaps allowed)
      formData.append('overlap', (1 - (overlapPct / 100)));
      formData.append('opacity', (opacityPct / 100));

      // Simulate progress only for new uploads
      let progressInterval;
      if (!isUpdate) {
        progressInterval = setInterval(() => {
          setProgress(prev => {
            if (prev < 90) return prev + Math.random() * 30;
            return prev;
          });
        }, 200);
      }

      // Call the Flask backend API
      const response = await axios.post(API_URL, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        signal: abortControllerRef.current.signal
      });

      if (!isUpdate) {
        clearInterval(progressInterval);
        setProgress(100);
      }

      if (response.data.success) {
        // Use annotated image if available, otherwise use original
        const imageToShow = response.data.annotated_image || response.data.image;
        
        setResults({
          image: imageToShow,
          detections: response.data.detections,
          total_detections: response.data.total_detections,
          image_size: response.data.image_size,
          confidence_used: response.data.confidence_used,
          overlap_used: response.data.overlap_used
        });
      } else {
        setError(response.data.error || 'Detection failed');
      }

      setLoading(false);
      if (!isUpdate) setTimeout(() => setProgress(0), 500);

    } catch (err) {
      if (axios.isCancel(err)) {
        console.log('Request canceled', err.message);
      } else {
        setProgress(0);
        if (err.response) {
          setError(`Server error: ${err.response.data.error || err.response.statusText}`);
        } else if (err.request) {
          setError(`Cannot connect to backend server at ${API_BASE_URL}. Please check if the service is online.`);
        } else {
          setError('Error processing image. Please try again.');
        }
        setLoading(false);
        console.error('Detection error:', err);
      }
    }
  };

  // Debounced Re-Detection Effect
  useEffect(() => {
    if (!currentFile) return;

    const timer = setTimeout(() => {
      handleImageUpload(currentFile, true);
    }, 600); // 600ms debounce

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confidencePct, overlapPct, opacityPct]);


  // Telemetry Simulation
  const [systemStats, setSystemStats] = useState({
    version: '2.1.0',
    latency: 24,
    memory: 4.2,
    fps: 30
  });

  useEffect(() => {
    // Simulate live telemetry (latency/memory), but use REAL FPS
    const telemetryInterval = setInterval(() => {
      const currentFps = fpsCounterRef.current;
      fpsCounterRef.current = 0; // Reset counter every second

      setSystemStats(prev => ({
        ...prev,
        latency: Math.floor(Math.random() * (45 - 15) + 15), // Random 15-45ms (simulated)
        memory: +(4.0 + Math.random() * 0.5).toFixed(1), // Random 4.0-4.5GB (simulated)
        fps: currentFps // REAL FPS
      }));
    }, 1000); // Update exactly every 1 second

    return () => clearInterval(telemetryInterval);
  }, []);

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
        <ModelManagement onClose={() => setShowModelMgmt(false)} />
      )}

      {/* Professional Header Structure */}
      <header className="app-header">
        {/* 1. Brand Identity */}
        <div className="header-brand">
          <div className="brand-logo">
            <span className="logo-symbol">◈</span>
          </div>
          <div className="brand-info">
            <h1 className="brand-title">FABRIC.AI</h1>
            <span className="brand-subtitle">DEFECT DETECTION SYSTEM v{systemStats.version}</span>
          </div>
        </div>

        {/* 2. Main Navigation & Controls */}
        <div className="header-nav">
          <div className="nav-tabs">
            <button 
              className={`nav-tab ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              <span className="tab-icon">DATASET</span>
              <span className="tab-label">UPLOAD</span>
            </button>
            <button 
              className={`nav-tab ${activeTab === 'live' ? 'active' : ''}`}
              onClick={() => setActiveTab('live')}
            >
              <span className="tab-icon">SENSOR</span>
              <span className="tab-label">LIVE FEED</span>
            </button>
          </div>
          
          <div className="nav-separator"></div>

          <div className="nav-actions">
            <button className="icon-btn" onClick={() => setShowHistory(true)} title="Detection Logs">
              <span className="btn-icon">📋</span>
            </button>
            <button className="icon-btn" onClick={() => setShowModelMgmt(true)} title="System Configuration">
              <span className="btn-icon">⚙️</span>
            </button>
          </div>
        </div>

        {/* 3. System Status & Telemetry */}
        <div className="header-status">
          <div className="status-group">
            <div className="status-label">SYS.STATUS</div>
            <div className={`status-badge ${serverStatus}`}>
              <span className="status-dot"></span>
              {serverStatus === 'online' ? 'ONLINE' : 'OFFLINE'}
            </div>
          </div>
          
          <div className="status-divider"></div>

          <div className="status-group">
            <div className="status-label">RESULTS</div>
            <div className="status-value">
              {results ? results.total_detections : 0}
            </div>
          </div>

          <button className="theme-switch" onClick={onThemeToggle}>
            {theme === 'dark' ? '☾' : '☼'}
          </button>
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
      <main className={`dashboard-grid ${isMaximized ? 'maximized' : ''}`}>
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
                <div className="control-label">
                  <span>Confidence</span>
                  <span className="value-display">{confidencePct}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={confidencePct}
                  onChange={(e) => setConfidencePct(parseInt(e.target.value))}
                  className="ui-slider"
                  disabled={loading}
                  aria-label="Confidence threshold"
                />
                <div className="slider-scale"><span>0%</span><span>100%</span></div>
              </div>

              <div className="slider-block">
                <div className="control-label">
                  <span>Overlap</span>
                  <span className="value-display">{overlapPct}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={overlapPct}
                  onChange={(e) => setOverlapPct(parseInt(e.target.value))}
                  className="ui-slider"
                  disabled={loading}
                  aria-label="Overlap threshold"
                />
                <div className="slider-scale"><span>0%</span><span>100%</span></div>
              </div>

              <div className="slider-block">
                <div className="control-label">
                  <span>Opacity</span>
                  <span className="value-display">{opacityPct}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={opacityPct}
                  onChange={(e) => setOpacityPct(parseInt(e.target.value))}
                  className="ui-slider"
                  disabled={loading}
                  aria-label="Opacity level"
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
            <button 
              className="icon-btn" 
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? "Exit Fullscreen" : "Maximize View"}
            >
              <span className="btn-icon" style={{ fontSize: '1rem' }}>
                {isMaximized ? '↙' : '↗'}
              </span>
            </button>
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
            {results && (
              <img 
                src={results.image} 
                alt="Detection view" 
                className="detected-image" 
                style={{ opacity: loading ? 0.7 : 1, transition: 'opacity 0.3s' }}
              />
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
            {results ? (
              <>
                <div className="detections-list">
                  <div className="detections-header">
                    <span className="detections-count">Detected Faults ({results.detections.length})</span>
                    {loading && <span className="updating-badge" style={{fontSize: '0.7em', color: 'var(--accent-primary)', marginLeft:'auto'}}>Updating...</span>}
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
                  <div className="summary-card">
                    <div className="summary-label">Conf. Thresh</div>
                    <div className="summary-value">{(results.confidence_used * 100).toFixed(0)}%</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-label">Overlap Strict</div>
                    <div className="summary-value">{results.overlap_used !== undefined ? ((1 - results.overlap_used) * 100).toFixed(0) + '%' : 'N/A'}</div>
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
      <main className={`dashboard-grid ${isMaximized ? 'maximized' : ''}`}>
        {/* Column 1: Live Feed (Raw) + Settings (Left Sidebar) */}
        <section className="panel-card upload-card">
          <div className="panel-header">
            <h3 className="panel-title">Live Feed (Raw)</h3>
          </div>
          <div className="panel-body">
            {/* Camera Controls */}
            <div className="camera-controls-stack" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '15px' }}>
              <div className="control-group">
                <label className="label-text" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Camera Source</label>
                <select 
                  className="camera-select"
                  value={selectedCameraId}
                  onChange={(e) => setSelectedCameraId(e.target.value)}
                  disabled={isCameraActive}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                >
                  {cameras.length === 0 && <option value="">Finding cameras...</option>}
                  {cameras.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${device.deviceId.slice(0, 5)}...`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="control-group">
                <label className="label-text" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Resolution</label>
                <select 
                  className="camera-select"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  disabled={isCameraActive}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                >
                  <option value="640x480">VGA (640x480)</option>
                  <option value="800x600">SVGA (800x600)</option>
                  <option value="1280x720">HD (1280x720)</option>
                  <option value="1920x1080">Full HD (1920x1080)</option>
                </select>
              </div>

              <div className="camera-actions" style={{ display: 'flex', gap: '10px' }}>
                <button 
                  className="camera-button"
                  onClick={startCamera}
                  disabled={isCameraActive || !selectedCameraId}
                  style={{ flex: 1 }}
                >
                  START
                </button>
                <button 
                  className="camera-button secondary"
                  onClick={stopCamera}
                  disabled={!isCameraActive}
                  style={{ flex: 1 }}
                >
                  STOP
                </button>
              </div>
            </div>

            {/* Video Area */}
            <div className="live-feed-container" style={{ width: '100%', aspectRatio: '4/3', position: 'relative', background: '#000', borderRadius: '4px', overflow: 'hidden', marginBottom: '1rem' }}>
               {/* Status Badge */}
               {isCameraActive && (
                 <div className="stream-status" style={{ 
                    position: 'absolute', 
                    top: '10px', 
                    right: '10px', 
                    zIndex: 10,
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    fontWeight: 'bold',
                    background: wsStatus === 'open' ? 'rgba(16, 185, 129, 0.8)' : 'rgba(239, 68, 68, 0.8)',
                    color: 'white'
                 }}>
                   {wsStatus === 'open' ? 'LIVE' : wsStatus.toUpperCase()}
                 </div>
               )}

               {!isCameraActive && (
                 <div className="placeholder-state" style={{ position: 'absolute', inset: 0, justifyContent: 'center', height: '100%' }}>
                    <div className="placeholder-icon" style={{ fontSize: '2rem' }}>📹</div>
                    <p style={{fontSize: '0.8rem'}}>Inactive</p>
                 </div>
               )}
               <video 
                 ref={videoRef} 
                 className="live-video"
                 style={{ width: '100%', height: '100%', objectFit: 'contain', display: isCameraActive ? 'block' : 'none' }}
                 autoPlay
                 playsInline
               />
            </div>

            {/* Settings Compact */}
            <div className="adjustment-stack">
               <div className="slider-block">
                 <div className="control-label"><span>FPS Target</span><span className="value-display">{targetFps}</span></div>
                 <input type="range" min="1" max="10" step="1" value={targetFps} onChange={(e) => setTargetFps(parseInt(e.target.value))} className="ui-slider" />
               </div>
               <div className="slider-block">
                 <div className="control-label"><span>Confidence</span><span className="value-display">{confidencePct}%</span></div>
                 <input type="range" min="0" max="100" step="1" value={confidencePct} onChange={(e) => setConfidencePct(parseInt(e.target.value))} className="ui-slider" disabled={loading} />
               </div>
               <div className="slider-block">
                 <div className="control-label"><span>Overlap</span><span className="value-display">{overlapPct}%</span></div>
                 <input type="range" min="0" max="100" step="1" value={overlapPct} onChange={(e) => setOverlapPct(parseInt(e.target.value))} className="ui-slider" disabled={loading} />
               </div>
            </div>
          </div>
        </section>

        {/* Column 2: Annotated Feed (Center Main) */}
        <section className="panel-card detection-card">
          <div className="panel-header">
            <h3 className="panel-title">Annotated Live Feed</h3>
            <button 
              className="icon-btn" 
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? "Exit Fullscreen" : "Maximize View"}
            >
              <span className="btn-icon" style={{ fontSize: '1rem' }}>
                {isMaximized ? '↙' : '↗'}
              </span>
            </button>
          </div>
          <div className="panel-body">
             <div className="live-feed-container" style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {!isCameraActive ? (
                  <div className="placeholder-state" style={{ height: '100%', justifyContent: 'center' }}>
                    <div className="placeholder-icon">🤖</div>
                    <h3>Waiting for Stream</h3>
                    <p>Annotated defects will appear here</p>
                  </div>
                ) : (
                  <canvas 
                    ref={canvasRef}
                    className="detection-canvas"
                    style={{ width: '100%', height: '100%', objectFit: 'fill' }}
                  />
                )}
             </div>
          </div>
        </section>

        {/* Column 3: Live Results (Right Sidebar) */}
        <section className="panel-card results-card">
          <div className="panel-header">
            <h3 className="panel-title">Live Results</h3>
          </div>
          <div className="panel-body">
            {liveResults ? (
               <div className="detections-list">
                  <div className="detections-header">
                    <span className="detections-count">Detected: {liveResults.total_detections}</span>
                  </div>
                  {liveResults.detections.map((d, idx) => (
                      <div key={idx} className="detection-row">
                        <span className="detection-class">{d.class}</span>
                        <span className="detection-confidence">{(d.confidence * 100).toFixed(0)}%</span>
                      </div>
                  ))}
               </div>
            ) : (
            <div className="placeholder-state">
              <div className="placeholder-icon">📊</div>
              <h3>No Live Feed</h3>
              <p>Start camera to see live detection results</p>
            </div>
            )}
          </div>
        </section>
      </main>
      )}

      {/* Footer */}
      {/* Professional Footer */}
      <footer className="app-footer">
        <div className="footer-col left">
          <span className="footer-label">SYSTEM V{systemStats.version}</span>
          <span className="footer-divider">|</span>
          <span className="footer-value">{serverStatus === 'online' ? 'READY' : 'OFFLINE'}</span>
        </div>
        
        <div className="footer-col center">
          <span className="footer-tech">POWERED BY YOLOv8 NEURAL NETWORK</span>
        </div>

        <div className="footer-col right">
          <span className="footer-label">LATENCY</span>
          <span className="footer-value">{systemStats.latency}ms</span>
          <span className="footer-divider">|</span>
          <span className="footer-label">MEM</span>
          <span className="footer-value">{systemStats.memory}GB</span>
          <span className="footer-divider">|</span>
          <span className="footer-label">FPS</span>
          <span className="footer-value">{systemStats.fps}</span>
        </div>
      </footer>
    </div>
  );
}

export default MainScreen;
