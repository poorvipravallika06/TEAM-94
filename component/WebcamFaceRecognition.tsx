import React, { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';
import { X, Camera, Loader2, Download } from 'lucide-react';
import { analyzeEmotionWithLLM, generateEmotionReport } from '../services/geminiServices';

interface FaceData {
  expression: string;
  confidence: number;
  detectionTime: string;
}

interface WebcamFaceRecognitionProps {
  onClose: () => void;
  notesContent: string;
}

const WebcamFaceRecognition: React.FC<WebcamFaceRecognitionProps> = ({ onClose, notesContent }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetecting, setIsDetecting] = useState(true);
  const [expressions, setExpressions] = useState<FaceData[]>([]);
  const [currentExpression, setCurrentExpression] = useState<string>('');
  const [stats, setStats] = useState({
    happy: 0,
    sad: 0,
    angry: 0,
    dull: 0,
    surprised: 0,
    fearful: 0,
    disgusted: 0,
    neutral: 0
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [emotionReport, setEmotionReport] = useState<string>('');
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load face-api models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading face-api models:', error);
        setIsLoading(false);
      }
    };

    loadModels();

    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
    };
  }, []);

  // Start webcam
  useEffect(() => {
    const startWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } }
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            startFaceDetection();
          };
        }
      } catch (error) {
        console.error('Error accessing webcam:', error);
        alert('Unable to access webcam. Please check permissions.');
      }
    };

    if (!isLoading) {
      startWebcam();
    }

    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
    };
  }, [isLoading]);

  // Face detection loop
  const startFaceDetection = () => {
    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current) return;

      try {
        const detections = await faceapi
          .detectAllFaces(videoRef.current, new faceapi.TinyFaceDetectorOptions())
          .withFaceExpressions();

        // Draw canvas
        const displaySize = {
          width: videoRef.current.offsetWidth,
          height: videoRef.current.offsetHeight
        };

        faceapi.matchDimensions(canvasRef.current, displaySize);
        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }

        // Draw detections
        resizedDetections.forEach((detection: any) => {
          const box = detection.detection.box;
          ctx?.strokeRect(box.x, box.y, box.width, box.height);
          ctx!.strokeStyle = '#4f46e5';
          ctx!.lineWidth = 2;

          // Get dominant expression
          const expressions = detection.expressions as Record<string, number>;
          const dominantExpression = Object.entries(expressions).reduce((a: [string, number], b: [string, number]) =>
            a[1] > b[1] ? a : b
          );

          const expression = dominantExpression[0];
          const confidence = ((dominantExpression[1] as number) * 100).toFixed(1);

          setCurrentExpression(`${expression} (${confidence}%)`);

          // Add to expressions history
          const faceData: FaceData = {
            expression: expression,
            confidence: parseFloat(confidence as string),
            detectionTime: new Date().toLocaleTimeString()
          };

          setExpressions(prev => [...prev.slice(-29), faceData]);

          // Update stats
          setStats(prev => ({
            ...prev,
            [expression as keyof typeof stats]: (prev[expression as keyof typeof stats] || 0) + 1
          }));

          // Draw expression label
          ctx!.fillStyle = '#4f46e5';
          ctx!.font = 'bold 16px Arial';
          ctx!.fillText(expression, box.x, box.y - 10);
        });
      } catch (error) {
        console.error('Error during face detection:', error);
      }
    }, 300);
  };

  // Analyze emotions with LLM
  const handleAnalyzeWithLLM = async () => {
    if (expressions.length === 0) {
      alert('No expressions detected yet. Please wait for the webcam to detect faces.');
      return;
    }

    setIsAnalyzing(true);

    try {
      const expressionSummary = {
        expressions: expressions,
        stats: stats,
        dominantExpression: Object.entries(stats).reduce((a, b) => a[1] > b[1] ? a : b)[0],
        notesContent: notesContent
      };

      const report = await analyzeEmotionWithLLM(expressionSummary);
      setEmotionReport(report);
    } catch (error) {
      console.error('Error analyzing emotions:', error);
      alert('Failed to analyze emotions. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Download report
  const handleDownloadReport = async () => {
    try {
      const pdfContent = await generateEmotionReport({
        expressions: expressions,
        stats: stats,
        analysis: emotionReport,
        notesContent: notesContent
      });

      const blob = new Blob([pdfContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `emotion_report_${new Date().getTime()}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Failed to generate report.');
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8 max-w-2xl w-full mx-4">
          <div className="flex flex-col items-center justify-center gap-4">
            <Loader2 className="h-12 w-12 text-indigo-600 animate-spin" />
            <p className="text-lg font-semibold text-slate-800">Loading Face Detection Models...</p>
            <p className="text-sm text-slate-500">This may take a moment on first load</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-pink-600 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Camera className="h-6 w-6 text-white" />
            <h2 className="text-2xl font-bold text-white">Face Expression Analysis</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white hover:bg-opacity-20 p-2 rounded-lg transition-all"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Webcam Feed */}
            <div className="lg:col-span-2">
              <div className="bg-slate-100 rounded-lg overflow-hidden relative aspect-video">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  className="w-full h-full object-cover"
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full"
                />
              </div>

              {currentExpression && (
                <div className="mt-4 p-4 bg-indigo-50 border-2 border-indigo-200 rounded-lg">
                  <p className="text-center text-lg font-semibold text-indigo-700">
                    Current Expression: {currentExpression}
                  </p>
                </div>
              )}
            </div>

            {/* Stats Panel */}
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <h3 className="font-semibold text-slate-800 mb-4">Expression Stats</h3>
                <div className="space-y-2 text-sm">
                  {Object.entries(stats).map(([emotion, count]) => (
                    <div key={emotion} className="flex items-center justify-between">
                      <span className="capitalize text-slate-700">{emotion}</span>
                      <span className="font-semibold text-indigo-600">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <h3 className="font-semibold text-slate-800 mb-2">Total Detections</h3>
                <p className="text-2xl font-bold text-indigo-600">{expressions.length}</p>
              </div>

              <button
                onClick={handleAnalyzeWithLLM}
                disabled={isAnalyzing || expressions.length === 0}
                className="w-full bg-gradient-to-r from-indigo-600 to-pink-600 text-white font-semibold py-3 px-4 rounded-lg hover:from-indigo-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  'Analyze with AI'
                )}
              </button>
            </div>
          </div>

          {/* Analysis Report */}
          {emotionReport && (
            <div className="mt-6">
              <div className="bg-indigo-50 rounded-lg p-6 border-2 border-indigo-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-indigo-800">AI Analysis Report</h3>
                  <button
                    onClick={handleDownloadReport}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                  >
                    <Download className="h-4 w-4" />
                    Download Report
                  </button>
                </div>
                <div className="prose prose-indigo max-w-none text-slate-700 whitespace-pre-wrap">
                  {emotionReport}
                </div>
              </div>
            </div>
          )}

          {/* Detection Controls */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setIsDetecting(!isDetecting)}
              className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
                isDetecting
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : 'bg-slate-300 text-slate-800 hover:bg-slate-400'
              }`}
            >
              {isDetecting ? 'Stop Detection' : 'Start Detection'}
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 rounded-lg font-semibold bg-slate-200 text-slate-800 hover:bg-slate-300 transition-all"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WebcamFaceRecognition;
