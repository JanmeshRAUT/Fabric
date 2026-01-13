import json
import os
from ..config import Config

import threading
import logging

logger = logging.getLogger(__name__)

class HistoryManager:
    def __init__(self, history_file):
        self.history_file = history_file
        self.lock = threading.Lock()
        self.history = self.load_history()
    
    def load_history(self):
        """Load history from JSON file"""
        if os.path.exists(self.history_file):
            try:
                with open(self.history_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load history: {e}")
                return []
        return []
    
    def save_history(self):
        """Save history to JSON file"""
        try:
            with self.lock:
                with open(self.history_file, 'w') as f:
                    json.dump(self.history, f, indent=2)
            return True
        except Exception as e:
            logger.error(f"Failed to save history: {e}")
            return False
    
    def add_record(self, record):
        """Add detection result to history"""
        with self.lock:
            self.history.append(record)
        # Save outside the append lock, though save has its own lock which is fine (re-entrant if RLock, but here independent)
        # Actually to be atomic, we should lock the whole operation if we want strict consistency, 
        # but here the critical section is modifying the list and the file.
        # Let's simple call save_history which locks again.
        self.save_history()
    
    def get_history(self, limit=100):
        """Get recent history records"""
        return self.history[-limit:]
    
    def clear_history(self):
        """Clear all history"""
        with self.lock:
            self.history = []
        self.save_history()

# Create singleton instance
history_manager = HistoryManager(Config.HISTORY_FILE)
