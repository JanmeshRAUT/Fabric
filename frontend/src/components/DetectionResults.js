import React from 'react';
import './DetectionResults.css';

const DetectionResults = ({ results }) => {
  if (!results) return null;

  return (
    <div className="detection-results">
      <h2>Detection Results</h2>
      
      <div className="results-grid">
        <div className="result-image-section">
          <h3>Analyzed Image</h3>
          <img 
            src={results.image} 
            alt="Analyzed fabric" 
            className="result-image"
          />
        </div>
        
        <div className="detections-section">
          <h3>Detected Faults ({results.detections.length})</h3>
          
          {results.detections.length === 0 ? (
            <div className="no-detections">
              <p>✓ No faults detected - Fabric appears to be in good condition!</p>
            </div>
          ) : (
            <div className="detections-list">
              {results.detections.map((detection, index) => (
                <div key={index} className="detection-item">
                  <div className="detection-header">
                    <span className="fault-type">{detection.class}</span>
                    <span className="confidence">
                      {(detection.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="detection-details">
                    <p>Bounding Box: [{detection.bbox.join(', ')}]</p>
                  </div>
                  <div className="confidence-bar">
                    <div 
                      className="confidence-fill"
                      style={{ width: `${detection.confidence * 100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      <div className="summary-section">
        <h3>Summary</h3>
        <div className="summary-stats">
          <div className="stat-card">
            <div className="stat-value">{results.detections.length}</div>
            <div className="stat-label">Total Faults</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              {results.detections.length > 0 
                ? [...new Set(results.detections.map(d => d.class))].length 
                : 0}
            </div>
            <div className="stat-label">Fault Types</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              {results.detections.length > 0
                ? (results.detections.reduce((sum, d) => sum + d.confidence, 0) / results.detections.length * 100).toFixed(1) + '%'
                : 'N/A'}
            </div>
            <div className="stat-label">Avg Confidence</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DetectionResults;
