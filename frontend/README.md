# Fabric Fault Detection - Frontend

This is the React frontend for the Fabric Fault Detection System using YOLO.

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

### Running the Application

Start the development server:
```bash
npm start
```

The application will open in your browser at [http://localhost:3000](http://localhost:3000).

### Building for Production

Create an optimized production build:
```bash
npm run build
```

The build files will be in the `build/` directory.

## Features

- **Image Upload**: Drag-and-drop or click to upload fabric images
- **Real-time Detection**: Integration with YOLO backend for fault detection
- **Visual Results**: Display detected faults with bounding boxes and confidence scores
- **Summary Statistics**: Overview of detected faults and fault types

## API Integration

The frontend is configured to communicate with a backend API. Update the API endpoint in `src/App.js`:

```javascript
const response = await axios.post('YOUR_API_ENDPOINT', formData);
```

## Project Structure

```
frontend/
├── public/
│   ├── index.html
│   └── robots.txt
├── src/
│   ├── components/
│   │   ├── ImageUpload.js
│   │   ├── ImageUpload.css
│   │   ├── DetectionResults.js
│   │   └── DetectionResults.css
│   ├── App.js
│   ├── App.css
│   ├── index.js
│   └── index.css
├── package.json
└── README.md
```

## Technologies Used

- React 18
- Axios for API calls
- CSS3 for styling
- React Hooks (useState, useRef)

## License

Part of the Fabric Fault Detection V1 project.
