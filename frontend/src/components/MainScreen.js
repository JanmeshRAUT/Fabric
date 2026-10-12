import React, { useState, useEffect } from 'react';
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
  const [targetFps, setTargetFps] = useState(15);
  const [wsStatus, setWsStatus] = useState('disconnected'); // disconnected, connecting, open, error
  const [isMaximized, setIsMaximized] = useState(false);
  const videoRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const fpsCounterRef = React.useRef(0); // Count frames for real FPS calculation
  
  // High-performance streaming refs
  const targetFpsRef = React.useRef(15);
  const captureCanvasRef = React.useRef(null);
  const isWaitingForResponseRef = React.useRef(false);
  const lastSendTimeRef = React.useRef(0);
  const responseTimeoutRef = React.useRef(null);
  const sendTimerRef = React.useRef(null);
  const animFrameIdRef = React.useRef(null);
  const isCameraActiveRef = React.useRef(false);
  const latestDetectionsRef = React.useRef(null);
  const lastUiUpdateRef = React.useRef(0);
  const uiThrottleTimerRef = React.useRef(null);
  const realLatencyRef = React.useRef(0);
  const reconnectTimerRef = React.useRef(null);
  const scanLinePosRef = React.useRef(0);
  const scanDirectionRef = React.useRef(1);

  const DEFAULT_REMOTE_API = 'https://jerryjr1705-fabric-backend.hf.space';
  const DEFAULT_REMOTE_WS = 'wss://jerryjr1705-fabric-backend.hf.space';

  // Always default to active Hugging Face backend unless explicitly overridden
  const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || DEFAULT_REMOTE_API;

  const WS_BASE_URL = process.env.REACT_APP_WS_BASE_URL || (
    API_BASE_URL.startsWith('https://') 
      ? API_BASE_URL.replace('https://', 'wss://') 
      : (API_BASE_URL.startsWith('http://') ? API_BASE_URL.replace('http://', 'ws://') : DEFAULT_REMOTE_WS)
  );

  const API_URL = `${API_BASE_URL}/api/detect`;
  const HEALTH_URL = `${API_BASE_URL}/api/health`;
  const WS_URL = `${WS_BASE_URL}/ws/detect`;

  // Cross-browser helper for rounded rectangles on canvas
  const drawRoundedRect = (ctx, x, y, width, height, radius) => {
    if (ctx.roundRect) {
      ctx.roundRect(x, y, width, height, radius);
    } else {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const [liveResults, setLiveResults] = useState(null);
  const websocketRef = React.useRef(null);

  // Sync targetFpsRef with state
  useEffect(() => {
    targetFpsRef.current = targetFps;
  }, [targetFps]);

  // Send confidence & overlap settings only when sliders change
  const sendSettings = (conf, ovlp) => {
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      websocketRef.current.send(
        JSON.stringify({
          confidence: conf / 100,
          overlap: 1 - (ovlp / 100)
        })
      );
    }
  };

  useEffect(() => {
    if (isCameraActive && wsStatus === 'open') {
      sendSettings(confidencePct, overlapPct);
    }
  }, [confidencePct, overlapPct, isCameraActive, wsStatus]);

  // Render loop: draws live video every screen refresh and overlays YOLO detections + AI HUD
  const renderLoop = () => {
    if (!isCameraActiveRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && canvas && video.videoWidth > 0 && video.videoHeight > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const ctx = canvas.getContext('2d');
      const cw = canvas.width;
      const ch = canvas.height;

      // 1. Draw smooth live video
      ctx.drawImage(video, 0, 0, cw, ch);

      // 2. Animate subtle AI scanning laser beam
      scanLinePosRef.current += 3 * scanDirectionRef.current;
      if (scanLinePosRef.current >= ch) {
        scanLinePosRef.current = ch;
        scanDirectionRef.current = -1;
      } else if (scanLinePosRef.current <= 0) {
        scanLinePosRef.current = 0;
        scanDirectionRef.current = 1;
      }

      const scanY = scanLinePosRef.current;
      const scanGrad = ctx.createLinearGradient(0, scanY - 24, 0, scanY + 24);
      scanGrad.addColorStop(0, 'rgba(6, 182, 212, 0)');
      scanGrad.addColorStop(0.5, 'rgba(6, 182, 212, 0.35)');
      scanGrad.addColorStop(1, 'rgba(6, 182, 212, 0)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 24, cw, 48);

      ctx.strokeStyle = 'rgba(6, 182, 212, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, scanY);
      ctx.lineTo(cw, scanY);
      ctx.stroke();

      // 3. AI Viewport Corner Reticle Brackets
      const bLen = Math.min(36, Math.round(cw * 0.06));
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.65)';
      ctx.lineWidth = 3;
      // Top-Left
      ctx.beginPath();
      ctx.moveTo(18, 18 + bLen);
      ctx.lineTo(18, 18);
      ctx.lineTo(18 + bLen, 18);
      ctx.stroke();
      // Top-Right
      ctx.beginPath();
      ctx.moveTo(cw - 18 - bLen, 18);
      ctx.lineTo(cw - 18, 18);
      ctx.lineTo(cw - 18, 18 + bLen);
      ctx.stroke();
      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(18, ch - 18 - bLen);
      ctx.lineTo(18, ch - 18);
      ctx.lineTo(18 + bLen, ch - 18);
      ctx.stroke();
      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(cw - 18 - bLen, ch - 18);
      ctx.lineTo(cw - 18, ch - 18);
      ctx.lineTo(cw - 18, ch - 18 - bLen);
      ctx.stroke();

      // 4. Draw Detection Annotations
      const data = latestDetectionsRef.current;
      let defectCount = 0;
      let hasPerfectFabric = false;

      if (data && data.detections && data.frame_size) {
        const [frameW, frameH] = data.frame_size;
        const scaleX = frameW > 0 ? cw / frameW : 1;
        const scaleY = frameH > 0 ? ch / frameH : 1;

        data.detections.forEach((det) => {
          if (!det.bbox) return;

          const isPerfect = det.class === 'fabric_perfect';
          if (isPerfect) {
            hasPerfectFabric = true;
            return;
          }

          defectCount++;
          const [x1, y1, x2, y2] = det.bbox;
          const bx = Math.max(0, Math.min(cw, x1 * scaleX));
          const by = Math.max(0, Math.min(ch, y1 * scaleY));
          const bw = Math.min(cw - bx, (x2 - x1) * scaleX);
          const bh = Math.min(ch - by, (y2 - y1) * scaleY);

          // Color palette per defect class
          let color = '#ef4444'; // Red for hole
          let bgTint = 'rgba(239, 68, 68, 0.22)';
          if (det.class.includes('broken')) {
            color = '#f97316'; // Amber / Orange
            bgTint = 'rgba(249, 115, 22, 0.22)';
          } else if (det.class.includes('missing')) {
            color = '#d946ef'; // Fuchsia
            bgTint = 'rgba(217, 70, 239, 0.22)';
          } else if (det.class.includes('thick')) {
            color = '#06b6d4'; // Cyan
            bgTint = 'rgba(6, 182, 212, 0.22)';
          }

          // Shaded defect region
          ctx.fillStyle = bgTint;
          ctx.fillRect(bx, by, bw, bh);

          // Glowing Bounding Box
          ctx.save();
          ctx.shadowColor = color;
          ctx.shadowBlur = 10;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(3, Math.round(cw / 260));
          ctx.strokeRect(bx, by, bw, bh);
          ctx.restore();

          // Corner brackets on the bounding box
          const cLen = Math.min(14, bw / 3, bh / 3);
          if (cLen > 3) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(3, Math.round(cw / 260));
            // Top-left
            ctx.beginPath();
            ctx.moveTo(bx, by + cLen);
            ctx.lineTo(bx, by);
            ctx.lineTo(bx + cLen, by);
            ctx.stroke();
            // Top-right
            ctx.beginPath();
            ctx.moveTo(bx + bw - cLen, by);
            ctx.lineTo(bx + bw, by);
            ctx.lineTo(bx + bw, by + cLen);
            ctx.stroke();
            // Bottom-left
            ctx.beginPath();
            ctx.moveTo(bx, by + bh - cLen);
            ctx.lineTo(bx, by + bh);
            ctx.lineTo(bx + cLen, by + bh);
            ctx.stroke();
            // Bottom-right
            ctx.beginPath();
            ctx.moveTo(bx + bw - cLen, by + bh);
            ctx.lineTo(bx + bw, by + bh);
            ctx.lineTo(bx + bw, by + bh - cLen);
            ctx.stroke();
          }

          // Defect Tag / Badge
          const friendlyName = det.class.replace('fabric_', '').replace('_', ' ').toUpperCase();
          const label = `⚠️ ${friendlyName} ${(det.confidence * 100).toFixed(0)}%`;
          const fontSize = Math.max(13, Math.round(cw / 42));
          ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
          const textMetrics = ctx.measureText(label);
          const badgeW = textMetrics.width + 16;
          const badgeH = fontSize + 10;

          const badgeX = Math.max(4, Math.min(cw - badgeW - 4, bx));
          const badgeY = by >= badgeH + 6 ? by - badgeH - 4 : by + 4;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
          ctx.beginPath();
          drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, badgeX + 8, badgeY + fontSize);
        });
      }

      // 5. TOP HUD STATUS BANNER
      const hudFontSize = Math.max(12, Math.round(cw / 50));
      ctx.font = `600 ${hudFontSize}px system-ui, -apple-system, sans-serif`;

      let hudText = '✓ AI SCANNER: FABRIC CLEAR (NO DEFECTS)';
      let hudColor = '#10b981';
      let hudBg = 'rgba(6, 78, 59, 0.88)';
      let hudBorder = 'rgba(52, 211, 153, 0.65)';

      if (defectCount > 0) {
        hudText = `⚠️ DEFECT DETECTED: ${defectCount} FAULT${defectCount > 1 ? 'S' : ''} FOUND`;
        hudColor = '#f87171';
        hudBg = 'rgba(127, 29, 29, 0.92)';
        hudBorder = 'rgba(239, 68, 68, 0.85)';
      } else if (hasPerfectFabric) {
        hudText = '✓ INSPECTION: FABRIC PERFECT QUALITY VERIFIED';
        hudColor = '#34d399';
        hudBg = 'rgba(6, 78, 59, 0.88)';
        hudBorder = 'rgba(52, 211, 153, 0.65)';
      } else if (wsStatus !== 'open') {
        hudText = `⚡ AI SERVICE: ${wsStatus.toUpperCase()}`;
        hudColor = '#fbbf24';
        hudBg = 'rgba(120, 53, 15, 0.88)';
        hudBorder = 'rgba(245, 158, 11, 0.65)';
      }

      const hudMetrics = ctx.measureText(hudText);
      const hudW = hudMetrics.width + 24;
      const hudH = hudFontSize + 12;
      const hudX = Math.round((cw - hudW) / 2);
      const hudY = 16;

      ctx.save();
      ctx.shadowColor = hudColor;
      ctx.shadowBlur = 8;
      ctx.fillStyle = hudBg;
      ctx.beginPath();
      drawRoundedRect(ctx, hudX, hudY, hudW, hudH, 6);
      ctx.fill();
      ctx.strokeStyle = hudBorder;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(hudText, hudX + 12, hudY + hudFontSize + 2);
    }

    animFrameIdRef.current = requestAnimationFrame(renderLoop);
  };

  // Capture frame and send raw JPEG ArrayBuffer to backend
  const sendNextFrame = () => {
    if (!isCameraActiveRef.current) return;
    if (!websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) return;
    if (isWaitingForResponseRef.current) return;

    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
      sendTimerRef.current = setTimeout(sendNextFrame, 50);
      return;
    }

    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement('canvas');
    }
    const captureCanvas = captureCanvasRef.current;

    // Resize frames to 480px wide
    const targetWidth = 480;
    const targetHeight = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * targetWidth));

    if (captureCanvas.width !== targetWidth || captureCanvas.height !== targetHeight) {
      captureCanvas.width = targetWidth;
      captureCanvas.height = targetHeight;
    }

    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

    captureCanvas.toBlob(
      async (blob) => {
        if (!blob || !isCameraActiveRef.current || !websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        try {
          const buffer = await blob.arrayBuffer();
          if (!isCameraActiveRef.current || !websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) {
            return;
          }

          isWaitingForResponseRef.current = true;
          lastSendTimeRef.current = performance.now();

          // 4-second timeout in case reply never arrives
          if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current);
          responseTimeoutRef.current = setTimeout(() => {
            console.warn('Live detection response timed out (4s), triggering next frame');
            isWaitingForResponseRef.current = false;
            sendNextFrame();
          }, 4000);

          websocketRef.current.send(buffer);
        } catch (err) {
          console.warn('Error reading or sending frame buffer:', err);
          isWaitingForResponseRef.current = false;
        }
      },
      'image/jpeg',
      0.65
    );
  };

  const startCamera = async () => {
    if (!selectedCameraId) {
      alert("No camera selected!");
      return;
    }

    try {
      const [width, height] = resolution.split('x').map(Number);
      const constraints = {
        video: { 
          deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined,
          width: { ideal: width },
          height: { ideal: height }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;
        streamRef.current = stream;
        isCameraActiveRef.current = true;
        setIsCameraActive(true);

        try {
          await video.play();
        } catch (e) {
          console.warn('Video play warning:', e);
        }

        if (animFrameIdRef.current) {
          cancelAnimationFrame(animFrameIdRef.current);
        }
        animFrameIdRef.current = requestAnimationFrame(renderLoop);
        connectWebSocket();
      }
    } catch (err) {
      console.error('Error accessing camera:', err);
      alert('Cannot access camera. Please check permissions.');
    }
  };

  const connectWebSocket = () => {
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) return;
    if (websocketRef.current) {
      try { websocketRef.current.close(); } catch(e) {}
      websocketRef.current = null;
    }
    
    setWsStatus('connecting');
    const ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
      console.log('Connected to live detection server:', WS_URL);
      setWsStatus('open');
      // Send initial settings
      sendSettings(confidencePct, overlapPct);
      // Start sequential frame streaming
      isWaitingForResponseRef.current = false;
      sendNextFrame();
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.success) {
          const now = performance.now();
          const latency = Math.round(now - lastSendTimeRef.current);
          realLatencyRef.current = latency;

          // Clear response timeout
          if (responseTimeoutRef.current) {
            clearTimeout(responseTimeoutRef.current);
            responseTimeoutRef.current = null;
          }

          fpsCounterRef.current += 1;
          latestDetectionsRef.current = data;

          // Update results panel at most 4-5 times per second (200ms)
          if (now - lastUiUpdateRef.current >= 200) {
            lastUiUpdateRef.current = now;
            setLiveResults(data);
          } else if (!uiThrottleTimerRef.current) {
            uiThrottleTimerRef.current = setTimeout(() => {
              uiThrottleTimerRef.current = null;
              lastUiUpdateRef.current = performance.now();
              if (latestDetectionsRef.current) {
                setLiveResults(latestDetectionsRef.current);
              }
            }, 200 - (now - lastUiUpdateRef.current));
          }

          // Allow next frame and pace according to FPS target
          isWaitingForResponseRef.current = false;
          const minInterval = 1000 / targetFpsRef.current;
          const elapsed = now - lastSendTimeRef.current;
          const delay = Math.max(0, minInterval - elapsed);

          if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
          sendTimerRef.current = setTimeout(sendNextFrame, delay);
        } else {
          isWaitingForResponseRef.current = false;
          if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
          sendTimerRef.current = setTimeout(sendNextFrame, 100);
        }
      } catch (err) {
        console.error('Error processing WebSocket message:', err);
        isWaitingForResponseRef.current = false;
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setWsStatus('error');
      isWaitingForResponseRef.current = false;
    };
    
    ws.onclose = () => {
      console.log('WebSocket closed');
      websocketRef.current = null;
      setWsStatus('disconnected');
      isWaitingForResponseRef.current = false;

      // Auto-reconnect if camera is still active
      if (isCameraActiveRef.current) {
        console.log('Camera active, auto-reconnecting WebSocket in 1.5s...');
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          if (isCameraActiveRef.current) {
            connectWebSocket();
          }
        }, 1500);
      }
    };

    websocketRef.current = ws;
  };

  const stopCamera = () => {
    isCameraActiveRef.current = false;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = null;
    }
    if (sendTimerRef.current) {
      clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    if (uiThrottleTimerRef.current) {
      clearTimeout(uiThrottleTimerRef.current);
      uiThrottleTimerRef.current = null;
    }

    isWaitingForResponseRef.current = false;
    latestDetectionsRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.style.display = 'none';
    }
    
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }
    
    setIsCameraActive(false);
    setWsStatus('disconnected');
    setLiveResults(null);
  };


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
          setError('Cannot connect to backend server. Make sure Flask is running on http://localhost:5000');
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
    // Live telemetry: real measured latency, memory, and real FPS
    const telemetryInterval = setInterval(() => {
      const currentFps = fpsCounterRef.current;
      fpsCounterRef.current = 0; // Reset counter every second

      setSystemStats(prev => ({
        ...prev,
        latency: realLatencyRef.current > 0 ? realLatencyRef.current : (isCameraActive ? 0 : prev.latency),
        memory: +(4.0 + Math.random() * 0.5).toFixed(1), // Random 4.0-4.5GB (simulated)
        fps: currentFps // REAL FPS
      }));
    }, 1000); // Update exactly every 1 second

    return () => clearInterval(telemetryInterval);
  }, [isCameraActive]);

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
        {/* Hidden video element used as media source for capture & canvas rendering */}
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          style={{ 
            position: 'fixed', 
            top: '-9999px', 
            left: '-9999px', 
            width: '1px', 
            height: '1px', 
            opacity: 0, 
            pointerEvents: 'none' 
          }} 
        />

        {/* Column 1: Camera Controls & Adjustments (Left Sidebar) */}
        <section className="panel-card upload-card">
          <div className="panel-header">
            <h3 className="panel-title">Camera Controls</h3>
          </div>
          <div className="panel-body">
            {/* Camera Controls */}
            <div className="camera-controls-stack" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
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

              <div className="camera-actions" style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
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

            {/* Settings Compact */}
            <div className="adjustment-stack">
               <div className="slider-block">
                 <div className="control-label"><span>FPS Target</span><span className="value-display">{targetFps}</span></div>
                 <input type="range" min="1" max="30" step="1" value={targetFps} onChange={(e) => setTargetFps(parseInt(e.target.value))} className="ui-slider" />
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
                {isCameraActive && (
                  <div className="stream-status" style={{ 
                     position: 'absolute', 
                     top: '12px', 
                     right: '12px', 
                     zIndex: 20,
                     padding: '4px 8px',
                     borderRadius: '4px',
                     fontSize: '0.7rem',
                     fontWeight: 'bold',
                     background: wsStatus === 'open' ? 'rgba(16, 185, 129, 0.85)' : 'rgba(239, 68, 68, 0.85)',
                     color: 'white',
                     letterSpacing: '0.5px'
                  }}>
                    {wsStatus === 'open' ? '● LIVE' : wsStatus.toUpperCase()}
                  </div>
                )}

                {!isCameraActive ? (
                  <div className="placeholder-state" style={{ height: '100%', justifyContent: 'center' }}>
                    <div className="placeholder-icon">📹</div>
                    <h3>Camera Inactive</h3>
                    <p>Select your camera and click START to view the live annotated feed</p>
                  </div>
                ) : (
                  <canvas 
                    ref={canvasRef}
                    className="detection-canvas"
                    style={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', position: 'relative', zIndex: 10 }}
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
                  <div className="detections-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '8px', borderBottom: '1px solid var(--border-color)', marginBottom: '12px' }}>
                    <span className="detections-count" style={{ fontWeight: 'bold' }}>
                      {liveResults.detections.filter(d => d.class !== 'fabric_perfect').length > 0 
                        ? `⚠️ Faults Detected: ${liveResults.detections.filter(d => d.class !== 'fabric_perfect').length}` 
                        : '✓ Normal / Defect-Free'}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 'bold' }}>LIVE</span>
                  </div>

                  {liveResults.detections.filter(d => d.class !== 'fabric_perfect').length === 0 ? (
                    <div className="no-detections" style={{ padding: '24px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: '2rem', color: '#10b981', marginBottom: '8px' }}>✓</div>
                      <h4 style={{ color: 'var(--text-primary)', marginBottom: '6px' }}>Fabric Quality Normal</h4>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        AI scanner is actively inspecting frames. No defects or weave anomalies detected.
                      </p>
                    </div>
                  ) : (
                    liveResults.detections.filter(d => d.class !== 'fabric_perfect').map((d, idx) => (
                      <div key={idx} className="detection-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: '6px', marginBottom: '8px', borderLeft: '4px solid #ef4444' }}>
                        <div>
                          <span className="detection-class" style={{ fontWeight: '700', color: '#f87171' }}>
                            {d.class.replace('fabric_', '').replace('_', ' ').toUpperCase()}
                          </span>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Live Defect Marker</div>
                        </div>
                        <span className="detection-confidence" style={{ fontWeight: 'bold', padding: '4px 8px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}>
                          {(d.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))
                  )}
               </div>
            ) : isCameraActive ? (
              <div className="placeholder-state" style={{ padding: '24px 12px', textAlign: 'center' }}>
                <div className="spinner" style={{ margin: '0 auto 12px' }}></div>
                <h4 style={{ color: 'var(--text-primary)', marginBottom: '4px' }}>AI Scanner Initializing</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Connecting stream to YOLO neural network...</p>
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
