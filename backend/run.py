import uvicorn
import os

if __name__ == "__main__":
    # Ensure logs directory exists before startup
    if not os.path.exists('logs'):
        os.makedirs('logs')
        
    print("\n" + "="*60)
    print("🚀 FABRIC DEFECT DETECTION API SERVER (FastAPI)")
    print("="*60)
    print(f"🌐 Server running on: http://localhost:5000")
    print(f"📄 Docs available at: http://localhost:5000/docs")
    print("="*60 + "\n")
    
    uvicorn.run("app.main:app", host="0.0.0.0", port=5000, reload=True)
