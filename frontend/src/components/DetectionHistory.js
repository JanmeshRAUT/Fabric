import React, { useState, useEffect } from 'react';
import './DetectionHistory.css';
import axios from 'axios';

const HISTORY_URL = 'http://localhost:5000/api/history';

function DetectionHistory({ onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState('date-desc');
  const [filterClass, setFilterClass] = useState('all');
  const [selectedRecord, setSelectedRecord] = useState(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const response = await axios.get(HISTORY_URL, { params: { limit: 200 } });
      if (response.data.success) {
        setHistory(response.data.history);
        setError(null);
      }
    } catch (err) {
      setError('Failed to load history');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (window.confirm('Are you sure you want to clear all history?')) {
      try {
        await axios.post('http://localhost:5000/api/history/clear');
        setHistory([]);
        setSelectedRecord(null);
      } catch (err) {
        setError('Failed to clear history');
      }
    }
  };

  const exportHistory = async (format) => {
    try {
      const response = await axios.get(`${HISTORY_URL}/export`, {
        params: { format }
      });
      
      const data = format === 'json' 
        ? JSON.stringify(response.data.data, null, 2)
        : generateCSV(response.data.data);
      
      const blob = new Blob([data], { 
        type: format === 'json' ? 'application/json' : 'text/csv' 
      });
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `detection-history.${format}`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Failed to export as ${format.toUpperCase()}`);
    }
  };

  const generateCSV = (data) => {
    if (!data || data.length === 0) return '';
    
    const keys = Object.keys(data[0]);
    const header = keys.join(',');
    const rows = data.map(obj => 
      keys.map(key => {
        const val = obj[key];
        if (Array.isArray(val)) return `"${val.join(', ')}"`;
        if (typeof val === 'object') return `"${JSON.stringify(val)}"`;
        return `"${val}"`;
      }).join(',')
    );
    
    return [header, ...rows].join('\n');
  };

  const getFilteredHistory = () => {
    let filtered = history;
    
    if (filterClass !== 'all') {
      filtered = filtered.filter(record => 
        record.detection_classes && record.detection_classes.includes(filterClass)
      );
    }
    
    // Sort
    if (sortBy === 'date-desc') {
      filtered = [...filtered].reverse();
    } else if (sortBy === 'date-asc') {
      filtered = [...filtered];
    } else if (sortBy === 'detections-high') {
      filtered = [...filtered].sort((a, b) => b.detections - a.detections);
    } else if (sortBy === 'detections-low') {
      filtered = [...filtered].sort((a, b) => a.detections - b.detections);
    }
    
    return filtered;
  };

  const allClasses = [
    'fabric_broken_pick',
    'fabric_hole',
    'fabric_missing_pick',
    'fabric_perfect',
    'fabric_thick_weft'
  ];

  const filteredHistory = getFilteredHistory();

  if (loading) {
    return (
      <div className="history-container">
        <div className="history-loading">
          <div className="spinner"></div>
          <p>Loading detection history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="history-container">
      <div className="history-header">
        <h2>Detection History</h2>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="history-controls">
        <div className="control-group">
          <label>Sort by:</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="detections-high">Most Detections</option>
            <option value="detections-low">Least Detections</option>
          </select>
        </div>

        <div className="control-group">
          <label>Filter by class:</label>
          <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)}>
            <option value="all">All Classes</option>
            {allClasses.map(cls => (
              <option key={cls} value={cls}>{cls}</option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <button 
            className="export-btn" 
            onClick={() => exportHistory('json')}
            disabled={history.length === 0}
          >
            Export JSON
          </button>
          <button 
            className="export-btn" 
            onClick={() => exportHistory('csv')}
            disabled={history.length === 0}
          >
            Export CSV
          </button>
          <button 
            className="clear-btn" 
            onClick={clearHistory}
            disabled={history.length === 0}
          >
            Clear History
          </button>
        </div>
      </div>

      <div className="history-content">
        {filteredHistory.length === 0 ? (
          <div className="empty-state">
            <p>No detection history found</p>
          </div>
        ) : (
          <div className="history-grid">
            {filteredHistory.map((record, index) => (
              <div 
                key={index}
                className={`history-card ${selectedRecord === index ? 'selected' : ''}`}
                onClick={() => setSelectedRecord(selectedRecord === index ? null : index)}
              >
                <div className="card-header">
                  <span className="detection-count">{record.detections}</span>
                  <span className="model-badge">
                    {record.model.split('/').pop().replace('.pt', '')}
                  </span>
                </div>
                <div className="card-details">
                  <p><strong>Timestamp:</strong> {new Date(record.timestamp).toLocaleString()}</p>
                  <p><strong>Confidence:</strong> {(record.confidence * 100).toFixed(1)}%</p>
                  <p><strong>Image Size:</strong> {record.image_size.width}x{record.image_size.height}</p>
                </div>
                {record.detection_classes && record.detection_classes.length > 0 && (
                  <div className="card-classes">
                    <strong>Classes Found:</strong>
                    <div className="class-tags">
                      {record.detection_classes.map(cls => (
                        <span key={cls} className="class-tag">{cls}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="history-stats">
        <div className="stat">
          <span className="stat-label">Total Records:</span>
          <span className="stat-value">{history.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Filtered:</span>
          <span className="stat-value">{filteredHistory.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Avg Detections:</span>
          <span className="stat-value">
            {history.length > 0 ? (history.reduce((sum, r) => sum + r.detections, 0) / history.length).toFixed(1) : 0}
          </span>
        </div>
      </div>
    </div>
  );
}

export default DetectionHistory;
