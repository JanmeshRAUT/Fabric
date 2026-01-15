import React, { useState, useEffect } from 'react';
import '../styles/ModelManagement.css';
import axios from 'axios';

const API_BASE = 'http://localhost:5000/api';

function ModelManagement({ onClose }) {
  const [models, setModels] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confidence, setConfidence] = useState(0.25);
  const [abTestEnabled, setAbTestEnabled] = useState(false);
  const [selectedModelA, setSelectedModelA] = useState('');
  const [selectedModelB, setSelectedModelB] = useState('');
  const [activeTab, setActiveTab] = useState('switch');
  const [switchingModel, setSwitchingModel] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE}/models`);
      setModels(response.data);
      setConfidence(response.data.confidence_threshold);
      setAbTestEnabled(response.data.ab_test_enabled);
      setError(null);
    } catch (err) {
      setError('Failed to load models');
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const refreshModels = async () => {
    setRefreshing(true);
    await fetchModels();
  };

  const switchModel = async (modelName) => {
    try {
      setSwitchingModel(modelName);
      const response = await axios.post(`${API_BASE}/models/switch`, {
        model_name: modelName
      });
      if (response.data.success) {
        fetchModels();
      }
    } catch (err) {
      setError(`Failed to switch to ${modelName}`);
    } finally {
      setSwitchingModel('');
    }
  };

  const updateConfidence = async (value) => {
    try {
      setConfidence(value);
      const response = await axios.post(`${API_BASE}/models/confidence`, {
        threshold: value
      });
      if (!response.data.success) {
        setError('Failed to update confidence threshold');
      }
    } catch (err) {
      setError('Failed to update confidence threshold');
    }
  };

  const setupABTest = async () => {
    if (!selectedModelA || !selectedModelB) {
      setError('Please select both models for A/B testing');
      return;
    }

    if (selectedModelA === selectedModelB) {
      setError('Please select different models for A/B testing');
      return;
    }

    try {
      const response = await axios.post(`${API_BASE}/models/ab-test`, {
        model_a: selectedModelA,
        model_b: selectedModelB
      });
      if (response.data.success) {
        setAbTestEnabled(true);
        setError(null);
      }
    } catch (err) {
      setError('Failed to setup A/B testing');
    }
  };

  const disableABTest = async () => {
    try {
      await axios.post(`${API_BASE}/models/ab-test/disable`);
      setAbTestEnabled(false);
      setError(null);
    } catch (err) {
      setError('Failed to disable A/B testing');
    }
  };

  const currentModelName = models ? (Object.keys(models.available_models || {}).find(
    key => models.available_models[key].path === models.current_model
  ) || 'Unknown') : 'Unknown';

  const renderContent = () => {
    if (loading && !models) {
      return (
        <div className="loading-skeleton">
          <div className="spinner"></div>
          <p>Loading model management...</p>
        </div>
      );
    }

    if (error && !models) {
      return (
        <div className="error-state">
          <span>⚠️ {error}</span>
          <button className="refresh-btn" onClick={fetchModels}>Retry</button>
        </div>
      );
    }

    if (!models) return null;

    return (
      <div className="model-management-body">
        <div className="model-tabs">
          <button
            className={`tab-btn ${activeTab === 'switch' ? 'active' : ''}`}
            onClick={() => setActiveTab('switch')}
          >
            Model Switching
          </button>
          <button
            className={`tab-btn ${activeTab === 'confidence' ? 'active' : ''}`}
            onClick={() => setActiveTab('confidence')}
          >
            Confidence Tuning
          </button>
          <button
            className={`tab-btn ${activeTab === 'abtest' ? 'active' : ''}`}
            onClick={() => setActiveTab('abtest')}
          >
            A/B Testing
          </button>
          <button
            className="refresh-btn"
            onClick={refreshModels}
            disabled={refreshing || loading}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {error && <div className="error-alert">{error}</div>}

        {/* Model Switching Tab */}
        {activeTab === 'switch' && (
          <div className="tab-content">
            <div className="section">
              <h3>Current Model</h3>
              <div className="current-model-info">
                <div className="model-badge-large">{currentModelName}</div>
                <p className="model-path">{models.current_model}</p>
              </div>
            </div>

            <div className="section">
              <h3>Available Models</h3>
              <div className="models-grid">
                {Object.entries(models.available_models || {}).map(([name, info]) => (
                  <div 
                    key={name}
                    className={`model-card ${name === currentModelName ? 'active' : ''}`}
                    onClick={() => switchModel(name)}
                  >
                    <div className="card-header">
                      <span className="model-name">{name}</span>
                      {name === currentModelName && <span className="active-badge">✓ Active</span>}
                    </div>
                    <div className="card-body">
                      <p className="info-text">
                        <strong>Exists:</strong> {info.exists ? '✓ Yes' : '✗ No'}
                      </p>
                      <p className="info-text">
                        <strong>Size:</strong> {info.size?.toFixed(2)} MB
                      </p>
                      <p className="info-text path-text">{info.path}</p>
                    </div>
                    <button 
                      className="switch-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        switchModel(name);
                      }}
                      disabled={name === currentModelName || switchingModel === name}
                    >
                      {switchingModel === name ? 'Switching…' : (name === currentModelName ? 'Currently Active' : 'Switch to Model')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Confidence Tuning Tab */}
        {activeTab === 'confidence' && (
          <div className="tab-content">
            <div className="section">
              <h3>Detection Confidence Threshold</h3>
              <p className="section-desc">
                Adjust the confidence level required for detections. Lower values detect more objects but may have more false positives.
              </p>

              <div className="confidence-control">
                <div className="slider-container">
                  <input
                    type="range"
                    min="10"
                    max="90"
                    value={confidence * 100}
                    onChange={(e) => updateConfidence(parseInt(e.target.value) / 100)}
                    className="confidence-slider"
                  />
                  <div className="slider-labels">
                    <span>10%</span>
                    <span>50%</span>
                    <span>90%</span>
                  </div>
                </div>

                <div className="confidence-display">
                  <div className="confidence-value">
                    {(confidence * 100).toFixed(0)}%
                  </div>
                  <p className="confidence-desc">
                    {confidence < 0.3 && 'Very Sensitive - Many detections'}
                    {confidence >= 0.3 && confidence < 0.5 && 'Sensitive - More detections'}
                    {confidence >= 0.5 && confidence < 0.7 && 'Balanced - Good balance'}
                    {confidence >= 0.7 && 'Strict - Only confident detections'}
                  </p>
                </div>
              </div>

              <div className="preset-buttons">
                <button 
                  className="preset-btn"
                  onClick={() => updateConfidence(0.15)}
                >
                  Very Sensitive (15%)
                </button>
                <button 
                  className="preset-btn"
                  onClick={() => updateConfidence(0.30)}
                >
                  Sensitive (30%)
                </button>
                <button 
                  className="preset-btn"
                  onClick={() => updateConfidence(0.50)}
                >
                  Balanced (50%)
                </button>
                <button 
                  className="preset-btn"
                  onClick={() => updateConfidence(0.75)}
                >
                  Strict (75%)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* A/B Testing Tab */}
        {activeTab === 'abtest' && (
          <div className="tab-content">
            <div className="section">
              <h3>A/B Model Testing</h3>
              <p className="section-desc">
                Compare results from two different models on the same image.
              </p>

              {abTestEnabled ? (
                <div className="abtest-active">
                  <div className="status-badge active">✓ A/B Testing Active</div>
                  <p>Model A: <strong>{selectedModelA}</strong></p>
                  <p>Model B: <strong>{selectedModelB}</strong></p>
                  <button 
                    className="disable-btn"
                    onClick={disableABTest}
                  >
                    Disable A/B Testing
                  </button>
                </div>
              ) : (
                <div className="abtest-setup">
                  <div className="model-selector">
                    <div className="selector-group">
                      <label>Model A:</label>
                      <select 
                        value={selectedModelA}
                        onChange={(e) => setSelectedModelA(e.target.value)}
                      >
                        <option value="">Select Model A</option>
                        {Object.keys(models.available_models || {}).map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="selector-group">
                      <label>Model B:</label>
                      <select 
                        value={selectedModelB}
                        onChange={(e) => setSelectedModelB(e.target.value)}
                      >
                        <option value="">Select Model B</option>
                        {Object.keys(models.available_models || {}).map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button 
                    className="enable-btn"
                    onClick={setupABTest}
                    disabled={!selectedModelA || !selectedModelB}
                  >
                    Enable A/B Testing
                  </button>
                </div>
              )}
            </div>

            <div className="section info-section">
              <h4>How A/B Testing Works:</h4>
              <ul className="info-list">
                <li>Upload an image to the detector</li>
                <li>Both models will process the image simultaneously</li>
                <li>Results from both models are displayed side-by-side</li>
                <li>Compare detection counts and accuracy</li>
                <li>Use results to optimize your preferred model</li>
              </ul>
            </div>
          </div>
        )}

        <div className="model-stats">
          <div className="stat-item">
            <span className="stat-label">Total Models:</span>
            <span className="stat-value">{Object.keys(models.available_models || {}).length}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Confidence:</span>
            <span className="stat-value">{(confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">A/B Test:</span>
            <span className="stat-value">{abTestEnabled ? 'Active' : 'Inactive'}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="model-modal-overlay" onClick={onClose}>
      <div className="model-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="model-modal-header">
          <h2>Model Management</h2>
          <button className="model-close-btn" onClick={onClose}>×</button>
        </div>
        {renderContent()}
      </div>
    </div>
  );
}

export default ModelManagement;
