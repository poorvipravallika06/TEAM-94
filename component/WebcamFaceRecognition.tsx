import React, { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';
import { loadFERModel, predictFER } from '../services/ferModelService';
import * as tf from '@tensorflow/tfjs';
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
  const [ferModel, setFerModel] = useState<tf.LayersModel | null>(null);
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
  const [labeledDescriptorsLoaded, setLabeledDescriptorsLoaded] = useState(false);
  const labeledDescriptorsRef = useRef<any[]>([]);
  const faceMatcherRef = useRef<any>(null);
  const [recognizedFaces, setRecognizedFaces] = useState<Record<string, { score: number; lastExpression: string; lastConfidence: number; detections: number; counts: Record<string, number>; lastUpdated?: number }>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [emotionReport, setEmotionReport] = useState<string>('');
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load face-api models
  useEffect(() => {
    const loadModels = async () => {
      try {
        // Use the official face-api.js CDN model URL
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/models/';
        
        console.log('Loading face-api models from:', MODEL_URL);
        
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        
        console.log('Face-api models loaded successfully');
        setIsLoading(false);
        // After loading models, load any labeled faces
        await loadLabeledFaces();
        // Load FER-2013 TensorFlow model if provided via env
        try {
          const modelUrl = (process.env.REACT_APP_FER_MODEL_URL || process.env.VITE_FER_MODEL_URL || (import.meta as any).env?.VITE_FER_MODEL_URL) as string | undefined;
          if (modelUrl) {
            const m = await loadFERModel(modelUrl);
            if (m) {
              setFerModel(m);
              console.log('FER model loaded from', modelUrl);
            }
          }
        } catch (err) {
          console.warn('Failed loading FER model', err);
        }
      } catch (error) {
        console.error('Error loading face-api models:', error);
        alert('Failed to load face recognition models. Please refresh the page and try again.');
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

  // Helper to ensure models are loaded on demand
  const loadFaceApiModels = async () => {
    if (!isLoading) return;
    try {
      const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/models/';
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);
      setIsLoading(false);
    } catch (err) {
      console.warn('Failed to load face-api models on demand', err);
      throw err;
    }
  };

  // Start webcam
  useEffect(() => {
    const startWebcam = async () => {
      try {
        console.log('Requesting camera access...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 640 }, 
            height: { ideal: 480 },
            facingMode: 'user'
          },
          audio: false
        });

        console.log('Camera access granted');

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            console.log('Video metadata loaded, starting face detection');
            videoRef.current?.play();
            startFaceDetection();
          };
        }
      } catch (error) {
        console.error('Error accessing webcam:', error);
        if (error instanceof DOMException) {
          if (error.name === 'NotAllowedError') {
            alert('Camera permission denied. Please allow camera access in your browser settings and refresh the page.');
          } else if (error.name === 'NotFoundError') {
            alert('No camera found. Please check that your camera is connected and not in use by another application.');
          } else {
            alert(`Camera error: ${error.message}`);
          }
        } else {
          alert('Unable to access webcam. Please check permissions and refresh the page.');
        }
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
            .withFaceLandmarks()
            .withFaceExpressions()
            .withFaceDescriptors();

        // Draw canvas
        const displaySize = {
          width: videoRef.current.offsetWidth,
          height: videoRef.current.offsetHeight
        };

        faceapi.matchDimensions(canvasRef.current, displaySize);
        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        setLastDetectionsCount(resizedDetections.length);

        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }

        if (resizedDetections.length === 0) {
          setCurrentExpression('No face detected - Position your face in front of the camera');
        }

        // Draw detections
        for (const detection of resizedDetections) {
          const box = detection.detection.box;
          // Determine recognition label (if labeled faces exist)
          let nameLabel = 'unknown';
          try {
            const descr = (detection as any).descriptor as Float32Array | undefined;
            if (descr && faceMatcherRef.current) {
              const best = faceMatcherRef.current.findBestMatch(descr);
              if (best && best.label && best.label !== 'unknown') {
                nameLabel = `${best.label}`;
              }
            }
          } catch (err) {
            console.warn('Recognition error:', err);
          }
          const isRecognized = nameLabel && nameLabel !== 'unknown';
          // Draw bounding box
          ctx!.strokeStyle = isRecognized ? '#ef4444' : '#4f46e5';
          ctx!.lineWidth = 3;
          ctx?.strokeRect(box.x, box.y, box.width, box.height);

          // Extract expression - use FER model if available, otherwise fall back to face-api expression
          let expression = 'unknown';
          let confidence = '0.0';
          if (ferModel) {
            try {
              const tmp = document.createElement('canvas');
              tmp.width = Math.max(1, Math.floor(box.width));
              tmp.height = Math.max(1, Math.floor(box.height));
              const tctx = tmp.getContext('2d');
              if (tctx && videoRef.current) {
                // Map display box coordinates back to video pixels
                const video = videoRef.current as HTMLVideoElement;
                const scaleX = video.videoWidth / displaySize.width;
                const scaleY = video.videoHeight / displaySize.height;
                const sx = Math.floor(box.x * scaleX);
                const sy = Math.floor(box.y * scaleY);
                const sw = Math.floor(box.width * scaleX);
                const sh = Math.floor(box.height * scaleY);
                tctx.drawImage(videoRef.current, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
                // eslint-disable-next-line no-await-in-loop
                const res = await predictFER(ferModel, tmp);
                if (res) {
                  expression = res.label;
                  confidence = res.confidence.toFixed(1);
                }
              }
            } catch (err) {
              console.warn('FER model predict failed', err);
            }
          } else {
            const expressions = (detection as any).expressions as Record<string, number>;
            const dominantExpression = Object.entries(expressions).reduce((a: [string, number], b: [string, number]) =>
              a[1] > b[1] ? a : b
            );
            expression = dominantExpression[0];
            confidence = ((dominantExpression[1] as number) * 100).toFixed(1);
          }
          setCurrentExpression(`${expression} (${confidence}%)`);

          // Add to expressions history
          const faceData: FaceData = {
            expression: expression,
            confidence: parseFloat(confidence as string),
            detectionTime: new Date().toLocaleTimeString()
          };

          setExpressions(prev => [...prev.slice(-29), faceData]);

          // Throttle stats and recognizedFaces updates per person to avoid duplicate counts
          const now = Date.now();
          const prevEntry = recognizedFaces[nameLabel] || { lastExpression: null as any, lastUpdated: 0 };
          const shouldUpdate = prevEntry.lastExpression !== expression || (now - (prevEntry.lastUpdated || 0) > 800);
          if (shouldUpdate) {
            // Update stats
            setStats(prev => ({
              ...prev,
              [expression as keyof typeof stats]: (prev[expression as keyof typeof stats] || 0) + 1
            }));
          }

          // Update recognized faces scoring
          const pointsMap: Record<string, number> = { happy: 2, neutral: 1, surprised: 1, sad: -2, angry: -3, fearful: -1, disgusted: -2, dull: 0 };
          const baseVal = pointsMap[expression as keyof typeof pointsMap] ?? 0;
          const deltaVal = Math.round(baseVal * (parseFloat(confidence as string) / 100));
          const displayScore = (recognizedFaces[nameLabel]?.score ?? 0) + deltaVal;

          setRecognizedFaces(prev => {
            const prevEntry = prev[nameLabel] || { score: 0, lastExpression: expression, lastConfidence: parseFloat(confidence as string), detections: 0, counts: { happy:0, sad:0, angry:0, neutral:0, surprised:0, fearful:0, disgusted:0, dull:0 } };
            // Mapping points
            const pointsMap: Record<string, number> = {
              happy: 2,
              neutral: 1,
              surprised: 1,
              sad: -2,
              angry: -3,
              fearful: -1,
              disgusted: -2,
              dull: 0
            };
            const base = pointsMap[expression as keyof typeof pointsMap] ?? 0;
            const delta = Math.round(base * (parseFloat(confidence as string) / 100));
            const newCounts = { ...prevEntry.counts };
            newCounts[expression] = (newCounts[expression] || 0) + 1;
            return {
              ...prev,
              [nameLabel]: {
                score: prevEntry.score + delta,
                lastExpression: expression,
                lastConfidence: parseFloat(confidence as string),
                detections: prevEntry.detections + 1,
                counts: newCounts
              }
            };
          });
          if (shouldUpdate) {
            postEventToServer({ face_label: nameLabel || 'unknown', emotion: expression, confidence: parseFloat(confidence as string), delta: deltaVal, timestamp: new Date().toISOString() });
          }

          // Draw expression label including computed display score and name if recognized
          ctx!.fillStyle = '#4f46e5';
          ctx!.font = 'bold 16px Arial';
          const namePart = nameLabel && nameLabel !== 'unknown' ? `${nameLabel} • ` : '';
          const drawText = `${namePart}${expression} (${confidence}%) • ${displayScore} pts`;
          ctx!.font = 'bold 16px Arial';
          const w = (ctx!.measureText(drawText).width || 0) + 8;
          ctx!.fillStyle = 'rgba(0,0,0,0.6)';
          ctx!.fillRect(box.x - 4, box.y - 24, w, 20);
          ctx!.fillStyle = '#fff';
          ctx!.fillText(drawText, box.x, box.y - 10);
        });
      } catch (error) {
        console.error('Error during face detection:', error);
      }
    }, 300);
  };
  
  const loadLabeledFaces = async () => {
    try {
      const raw = localStorage.getItem('gvp_labeled_faces');
      if (!raw) {
        labeledDescriptorsRef.current = [];
        faceMatcherRef.current = null;
        setLabeledDescriptorsLoaded(true);
        return;
      }

      const parsed = JSON.parse(raw) as Record<string, number[][]>;
      const labeled = Object.entries(parsed).map(([label, arrays]) => {
        const descriptors = (arrays || []).map(a => new Float32Array(a));
        return new (faceapi as any).LabeledFaceDescriptors(label, descriptors);
      });

      labeledDescriptorsRef.current = labeled;
      if (labeled.length > 0) {
        faceMatcherRef.current = new (faceapi as any).FaceMatcher(labeled, 0.6);
      }
      setLabeledDescriptorsLoaded(true);
      console.log('Loaded labeled faces:', labeled.length);
    } catch (err) {
      console.warn('Failed to load labeled faces', err);
      setLabeledDescriptorsLoaded(true);
    }
  };

  const postEventToServer = async (payload: any) => {
    try {
      const server = process.env.REACT_APP_GVP_SERVER || 'http://localhost:4000';
      await fetch(server + '/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (err) {
      // ignore
    }
  };

  const enrollFace = async (label = 'Me') => {
    try {
      if (!videoRef.current) throw new Error('Video not ready');
      if (isLoading) {
        try {
          await loadFaceApiModels();
        } catch (err) {
          throw new Error('Models not loaded yet');
        }
      }
      // Ensure camera playing
      try { await videoRef.current.play(); } catch (_) {}

      // Try multiple times to get a good descriptor; sometimes the detector fails on first pass
      let result: any = null;
      for (let i = 0; i < 4; i++) {
        console.debug('Enroll attempt', i + 1);
        result = await faceapi.detectSingleFace(videoRef.current!, new (faceapi as any).TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.2 })).withFaceLandmarks().withFaceDescriptor();
        console.debug('Enroll result', result);
        if (result && result.descriptor) break;
        await new Promise(r => setTimeout(r, 250));
      }
      // If still no result, try a multi-face pass and take the most confident one
      if (!result || !result.descriptor) {
        const all = await faceapi.detectAllFaces(videoRef.current!, new (faceapi as any).TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.15 })).withFaceLandmarks().withFaceDescriptor();
        if (all && all.length > 0) {
          // choose biggest bounding box area as the main face
          all.sort((a: any, b: any) => (b.detection.box.width * b.detection.box.height) - (a.detection.box.width * a.detection.box.height));
          result = all[0];
        }
      }
      if (!result || !result.descriptor) {
        alert('No face detected for enrollment — please position your face closer to the camera and try again.');
        return;
      }

      const descriptorArr = Array.from(result.descriptor as Float32Array);
      const raw = localStorage.getItem('gvp_labeled_faces');
      const parsed = raw ? JSON.parse(raw) as Record<string, number[][]> : {};
      parsed[label] = parsed[label] || [];
      parsed[label].push(descriptorArr);
      localStorage.setItem('gvp_labeled_faces', JSON.stringify(parsed));

      // rebuild matcher
      await loadLabeledFaces();
      // persist the enrolled face to the server (if running on localhost)
      try {
        const server = process.env.REACT_APP_GVP_SERVER || 'http://localhost:4000';
        await fetch(server + '/faces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, descriptor: descriptorArr }) });
      } catch (err) {
        // ignore
      }
      // set the newly enrolled person in recognizedFaces so they show up immediately
      setRecognizedFaces(prev => ({
        ...prev,
        [label]: prev[label] || { score: 0, lastExpression: 'neutral', lastConfidence: 0, detections: 0, counts: { happy:0, sad:0, angry:0, neutral:0, surprised:0, fearful:0, disgusted:0, dull:0 }, lastUpdated: Date.now() }
      }));
      alert(`Enrolled face as '${label}'.`);
    } catch (err: any) {
      console.error('Enroll failed', err);
      alert('Failed to enroll face: ' + (err?.message || String(err)));
    }
  };

  // Analyze emotions with LLM
  // Analyze emotions with LLM - Auto-trigger when sufficient data collected
  useEffect(() => {
    // Auto-analyze every 5 seconds if we have enough expression data
    const autoAnalyzeInterval = setInterval(async () => {
      if (expressions.length >= 10 && !isAnalyzing && emotionReport.length === 0) {
        await performEmotionAnalysis();
      }
    }, 5000);

    return () => clearInterval(autoAnalyzeInterval);
  }, [expressions, isAnalyzing, emotionReport]);

  const performEmotionAnalysis = async () => {
    if (expressions.length === 0) {
      return;
    }

    setIsAnalyzing(true);

    try {
      const dominantExpressionEntry = Object.entries(stats).reduce((a, b) => a[1] > b[1] ? a : b);
      const expressionSummary = {
        expressions: expressions,
        stats: stats,
        dominantExpression: dominantExpressionEntry[0],
        notesContent: notesContent
      };

      console.log('Auto-analyzing emotions with LLM:', expressionSummary);
      const report = await analyzeEmotionWithLLM(expressionSummary);
      setEmotionReport(report);
    } catch (error) {
      console.error('Error analyzing emotions:', error);
      // Don't show alert for auto-analysis, just log it
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyzeWithLLM = async () => {
    if (expressions.length === 0) {
      alert('No expressions detected yet. Please wait for the webcam to detect faces.');
      return;
    }

    await performEmotionAnalysis();
  };

  // Download report
  const handleDownloadReport = async () => {
    try {
          // Update recognized faces scoring with throttling
          const pointsMap: Record<string, number> = { happy: 2, neutral: 1, surprised: 1, sad: -2, angry: -3, fearful: -1, disgusted: -2, dull: 0 };
          const baseVal = pointsMap[expression as keyof typeof pointsMap] ?? 0;
          const deltaVal = Math.round(baseVal * (parseFloat(confidence as string) / 100));
          const displayScore = (recognizedFaces[nameLabel]?.score ?? 0) + deltaVal;
          const now = Date.now();

          setRecognizedFaces(prev => {
            const prevEntry = prev[nameLabel] || { score: 0, lastExpression: expression, lastConfidence: parseFloat(confidence as string), detections: 0, counts: { happy:0, sad:0, angry:0, neutral:0, surprised:0, fearful:0, disgusted:0, dull:0 }, lastUpdated: 0 };
            const shouldUpdate = prevEntry.lastExpression !== expression || (now - (prevEntry.lastUpdated || 0) > 800);
            if (!shouldUpdate) {
              return {
                ...prev,
                [nameLabel]: {
                  ...prevEntry,
                  lastConfidence: parseFloat(confidence as string),
                  detections: prevEntry.detections + 1,
                  lastUpdated: now
                }
              };
            }
            const newCounts = { ...prevEntry.counts };
            newCounts[expression] = (newCounts[expression] || 0) + 1;
            return {
              ...prev,
              [nameLabel]: {
                score: prevEntry.score + deltaVal,
                lastExpression: expression,
                lastConfidence: parseFloat(confidence as string),
                detections: prevEntry.detections + 1,
                counts: newCounts,
                lastUpdated: now
              }
            };
          });

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
              {/* Real-time Mood Status */}
              <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-4 border-2 border-purple-200">
                <h3 className="font-semibold text-slate-800 mb-3">Live Mood Analysis</h3>
                <div className="space-y-3">
                  {currentExpression && (
                    <div className="p-3 bg-white rounded border-l-4 border-purple-500">
                      <p className="text-sm font-semibold text-purple-700">Current Mood</p>
                      <p className="text-lg font-bold text-slate-800">{currentExpression}</p>
                    </div>
                  )}
                  
                  {Object.entries(stats).length > 0 && (
                    <div className="p-3 bg-white rounded border-l-4 border-pink-500">
                      <p className="text-sm font-semibold text-pink-700">Dominant Emotion</p>
                      <p className="text-lg font-bold text-slate-800">
                        {Object.entries(stats).reduce((a, b) => a[1] > b[1] ? a : b)[0]?.toUpperCase()}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Detected: {expressions.length} frames
                      </p>
                    </div>
                  )}
                  
                  {isAnalyzing && (
                    <div className="p-3 bg-blue-50 rounded border-l-4 border-blue-500 flex items-center gap-2">
                      <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                      <p className="text-sm text-blue-700">Analyzing mood...</p>
                    </div>
                  )}
                  
                  {emotionReport && (
                    <div className="p-3 bg-green-50 rounded border-l-4 border-green-500">
                      <p className="text-sm font-semibold text-green-700">✓ Analysis Complete</p>
                      <p className="text-xs text-slate-600 mt-1">Mood report generated</p>
                    </div>
                  )}
                </div>
              </div>

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
                <h3 className="font-semibold text-slate-800 mb-3">Recognized Faces</h3>
                {Object.keys(recognizedFaces).length === 0 ? (
                  <p className="text-sm text-slate-500">No recognized faces yet. Enroll a face to enable recognition.</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    {Object.entries(recognizedFaces).map(([name, info]) => (
                      <div key={name} className="mb-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-slate-800">{name}</div>
                            <div className="text-xs text-slate-500">{info.lastExpression} • {info.lastConfidence}% • {info.detections} detections</div>
                          </div>
                          <div className="text-right">
                            <div className="text-indigo-600 font-bold">{info.score} pts</div>
                          </div>
                        </div>
                        <div className="mt-2 w-full grid grid-cols-4 gap-2 text-xs text-slate-700">
                          {Object.entries(info.counts || {}).map(([emo, cnt]) => (
                            <div key={emo} className="text-center">
                              <div className="capitalize text-slate-700">{emo}</div>
                              <div className="font-semibold text-indigo-600">{cnt}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <button onClick={() => enrollFace('Me')} disabled={isLoading || !videoRef.current} title={isLoading ? 'Models loading...' : (!videoRef.current ? 'Camera not ready' : 'Enroll as Me')} className="flex-1 py-2 px-3 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-40">Enroll as Me</button>
                  <button onClick={() => {
                    const name = prompt('Enter label/name for enrollment');
                    if (name && name.trim()) enrollFace(name.trim());
                  }} disabled={isLoading || !videoRef.current} title={isLoading ? 'Models loading...' : (!videoRef.current ? 'Camera not ready' : 'Enroll with Name')} className="flex-1 py-2 px-3 rounded-lg bg-slate-200 text-slate-800 text-sm disabled:opacity-40">Enroll with Name</button>
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <h3 className="font-semibold text-slate-800 mb-3">Emotion Points</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {(() => {
                    const pointsMap: Record<string, number> = { happy: 2, neutral: 1, surprised: 1, sad: -2, angry: -3, fearful: -1, disgusted: -2, dull: 0 };
                    const entries = Object.entries(stats);
                    const totals = entries.map(([emo, count]) => ({ emo, count, points: (pointsMap[emo] || 0) * count }));
                    const totalPoints = totals.reduce((s, it) => s + it.points, 0);
                    return (
                      <>
                        {totals.map(t => (
                          <div key={t.emo} className="flex items-center justify-between">
                            <span className="capitalize text-slate-700">{t.emo}</span>
                            <span className="font-semibold text-indigo-600">{t.points}</span>
                          </div>
                        ))}
                        <div className="col-span-2 border-t pt-2 text-right font-bold text-indigo-700">Total: {totalPoints}</div>
                      </>
                    );
                  })()}
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
