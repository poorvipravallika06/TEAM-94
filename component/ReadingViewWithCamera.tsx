import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Volume2, Download, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import * as faceapi from 'face-api.js';
import { loadFERModel, predictFER } from '../services/ferModelService';
import * as tf from '@tensorflow/tfjs';
import AIReliefGame from './AIReliefGame.tsx';

interface ReadingViewWithCameraProps {
  htmlContent: string;
  fileName: string;
  studentLanguage?: string;
  onClose: () => void;
  onDownload: () => void;
  onSessionUpdate?: (points: Record<string, number>) => void;
}

interface FaceExpression {
  happy: number;
  sad: number;
  angry: number;
  neutral: number;
  surprised: number;
  fearful: number;
  disgusted: number;
  dull: number;
}

const ReadingViewWithCamera: React.FC<ReadingViewWithCameraProps> = ({
  htmlContent,
  fileName,
  studentLanguage = 'English',
  onClose,
  onDownload,
  onSessionUpdate
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [estimatedPageCount, setEstimatedPageCount] = useState(1);
  const [showGame, setShowGame] = useState(false);
  const [isReading, setIsReading] = useState(true);
  const [showCameraModal, setShowCameraModal] = useState(false);
  
  // Camera and emotion detection state
  const [cameraActive, setCameraActive] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [lastDetectionsCount, setLastDetectionsCount] = useState<number | null>(null);
  const [lastDetectError, setLastDetectError] = useState<string | null>(null);
  const [currentEmotion, setCurrentEmotion] = useState<string>('neutral');
  const [emotionStats, setEmotionStats] = useState<FaceExpression>({
    happy: 0, sad: 0, angry: 0, neutral: 0,
    surprised: 0, fearful: 0, disgusted: 0, dull: 0
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisResults, setAnalysisResults] = useState<string>('');
  const [tfLoaded, setTfLoaded] = useState(false);
  const [ferModel, setFerModel] = useState<tf.LayersModel | null>(null);
  const [labeledDescriptorsLoaded, setLabeledDescriptorsLoaded] = useState(false);
  const labeledDescriptorsRef = useRef<any[]>([]);
  const faceMatcherRef = useRef<any>(null);
  const [recognizedName, setRecognizedName] = useState<string | null>(null);
  const [recognizedDistance, setRecognizedDistance] = useState<number | null>(null);
  const [detectionCount, setDetectionCount] = useState(0);
  const [cameraError, setCameraError] = useState<string>('');
  const [needsUserGesture, setNeedsUserGesture] = useState(false);
  const [recognizedFaces, setRecognizedFaces] = useState<Record<string, { score: number; lastExpression: string; lastConfidence: number; detections: number; counts: Record<string, number>; lastUpdated?: number }>>({});
  const [emotionPoints, setEmotionPoints] = useState<Record<string, number>>({
    happy: 0, sad: 0, angry: 0, neutral: 0, surprised: 0, fearful: 0, disgusted: 0, dull: 0
  });
  const [sessionId, setSessionId] = useState<number | null>(null);

  // Persist aggregated emotion points so other components (Dashboard, Notes) can read them
  useEffect(() => {
    try {
      localStorage.setItem('gvp_emotion_points', JSON.stringify(emotionPoints));
      // notify parent if provided
      try { if (onSessionUpdate) onSessionUpdate(emotionPoints); } catch (e) {}
    
    } catch (e) {
      // ignore
    }
  }, [emotionPoints]);

  // Start a session on mount so events can be grouped
  useEffect(() => {
    const start = async () => {
      try {
        const server = process.env.REACT_APP_GVP_SERVER || 'http://localhost:4000';
        const res = await fetch(server + '/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fileName, meta: { source: 'notes', fileName } }) });
        const j = await res.json();
        if (j && j.id) setSessionId(j.id);
      } catch (e) {
        // ignore
      }
    };
    start();
    return () => {
      // nothing for now
    };
  }, [fileName]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const analysisBufferRef = useRef<string[]>([]);
  const analysisModeRef = useRef<boolean>(false);
  const analysisTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tfModelRef = useRef<any>(null);

  // Estimate page count based on content length
  useEffect(() => {
    if (htmlContent) {
      const length = htmlContent.length;
      const estimated = Math.ceil(length / 3000);
      setEstimatedPageCount(Math.max(5, estimated));
    }
  }, [htmlContent]);

  // Initialize camera on mount
  useEffect(() => {
    const initializeAsync = async () => {
      // Start camera immediately without waiting for models
      const cameraPromise = initializeCamera();
      
      // Load models in parallel with camera
      const modelPromise = (async () => {
        try {
          const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/models/';
          console.log('Loading face-api models...');
          
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
          ]);
          console.log('✓ Face-api models loaded');
          setModelsLoaded(true);
        } catch (error) {
          console.error('Error loading models:', error);
          setCameraError('Face detection models failed to load. Camera active but detection unavailable.');
        }
      })();
      
      // Wait for both to complete
      await Promise.all([cameraPromise, modelPromise]);

      // After models are loaded, load any labeled faces for recognition
      await loadLabeledFaces();
      // Attempt to load a FER-2013 TF.js model if provided through environment variables
      try {
        const modelUrl = (process.env.REACT_APP_FER_MODEL_URL || process.env.VITE_FER_MODEL_URL || (import.meta as any).env?.VITE_FER_MODEL_URL) as string | undefined;
        if (modelUrl) {
          const m = await loadFERModel(modelUrl);
          if (m) {
            setFerModel(m);
            console.log('FER model loaded in ReadingViewWithCamera from', modelUrl);
          }
        }
      } catch (err) {
        console.warn('FER model load failed in ReadingViewWithCamera', err);
      }
    };
    
    initializeAsync();
    
    return () => {
      stopCamera();
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
    };
  }, []);

  // Helper to load face-api models on demand
  const loadFaceApiModels = async () => {
    if (modelsLoaded) return;
    try {
      const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/models/';
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);
      setModelsLoaded(true);
      console.log('Models loaded (on-demand)');
    } catch (err) {
      console.warn('Failed to load models on demand', err);
      throw err;
    }
  };

  const postEventToServer = async (payload: any) => {
    try {
      const server = process.env.REACT_APP_GVP_SERVER || 'http://localhost:4000';
      const body = { ...payload, session_id: sessionId };
      await fetch(server + '/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (err) {
      // ignore
    }
  };

  const initializeCamera = async () => {
    try {
      setCameraError('');
      console.log('Requesting camera access...');
      
      // Request camera permission explicitly
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      console.log('✓ Camera stream obtained');

      if (videoRef.current) {
        // attach stream to the visible video element
        try {
          // detach any previous stream
          if (videoRef.current.srcObject) {
            const prev = videoRef.current.srcObject as MediaStream;
            prev.getTracks().forEach(t => t.stop());
          }
        } catch (e) {
          console.warn('Error stopping previous tracks', e);
        }

        videoRef.current.srcObject = stream;

        // Mark camera active immediately so UI shows video container
        setCameraActive(true);

        // Start detection loop right away; detection will be a no-op until models load
        try {
          startFaceDetection();
        } catch (e) {
          console.warn('startFaceDetection delayed until models available', e);
        }

        // Attempt to play video; don't block UI if play is delayed
        try {
          const playPromise = videoRef.current.play();
          if (playPromise && typeof playPromise.then === 'function') {
            playPromise
              .then(() => {
                console.log('✓ Video playing');
              })
              .catch(err => {
                console.warn('Video play rejected (autoplay policy?), will retry on interaction', err);
                setNeedsUserGesture(true);
              });
          }
        } catch (err) {
          console.warn('Video play error:', err);
        }
        
        return Promise.resolve();
      }
    } catch (error: any) {
      console.error('Camera access error:', error);
      if (error.name === 'NotAllowedError') {
        setCameraError('Camera permission denied. Please allow camera access in your browser settings.');
      } else if (error.name === 'NotFoundError') {
        setCameraError('No camera found on this device.');
      } else {
        setCameraError(error.message || 'Failed to access camera');
      }
      setCameraActive(false);
    }
  };

  // Helper to attach stream and try to play (used by overlay button)
  const attachAndPlay = async () => {
    try {
      if (!videoRef.current) return;
      const stream = videoRef.current.srcObject as MediaStream | null;
      console.log('attachAndPlay: current srcObject', !!stream);

      // If no stream available, re-init camera
      if (!stream) {
        await initializeCamera();
      }

      // Force play attempt
      try {
        await videoRef.current.play();
        console.log('attachAndPlay: video.play() successful');
        setNeedsUserGesture(false);
        setCameraError('');
      } catch (err) {
        console.warn('attachAndPlay playback failed', err);
        setCameraError('Playback blocked. Please interact with the page or allow camera.');
        setNeedsUserGesture(true);
      }
    } catch (err) {
      console.error('attachAndPlay error', err);
    }
  };

  // Load labeled faces from localStorage and build FaceMatcher
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

  // Enroll the current user face as the provided label (default: "Me")
  const enrollFace = async (label = 'Me') => {
    try {
      if (!videoRef.current) throw new Error('Video not ready');
      if (!modelsLoaded) {
        // Attempt to load models if they weren't loaded yet
        try {
          await loadFaceApiModels();
        } catch (err) {
          throw new Error('Models not loaded yet');
        }
      }
      if (!cameraActive) throw new Error('Camera not active');
      // Try to resume playback if paused
      try { await attachAndPlay(); } catch (_) {}
      // Detect single face and extract descriptor
      // Try multiple times to get a descriptor; helps when the first detection is false-negative
      let result: any = null;
      for (let i = 0; i < 4; i++) {
        console.debug('Enroll attempt', i + 1);
        result = await faceapi.detectSingleFace(videoRef.current!, new (faceapi as any).TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.2 })).withFaceLandmarks().withFaceDescriptor();
        console.debug('Enroll result', result);
        if (result && result.descriptor) break;
        await new Promise(res => setTimeout(res, 250));
      }
      if (!result || !result.descriptor) {
        // Try with detectAllFaces and pick largest
        const all = await faceapi.detectAllFaces(videoRef.current!, new (faceapi as any).TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.15 })).withFaceLandmarks().withFaceDescriptor();
        if (all && all.length > 0) {
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
      setRecognizedFaces(prev => ({
        ...prev,
        [label]: prev[label] || { score: 0, lastExpression: 'neutral', lastConfidence: 0, detections: 0, counts: { happy:0, sad:0, angry:0, neutral:0, surprised:0, fearful:0, disgusted:0, dull:0 }, lastUpdated: Date.now() }
      }));
      alert(`Enrolled face as '${label}'. You can re-open the view to verify recognition.`);
    } catch (err: any) {
      console.error('Enroll failed', err);
      alert('Failed to enroll face: ' + (err?.message || String(err)));
    }
  };

  // Run a single detection pass and report results (debug helper)
  const runDetection = async () => {
    try {
      if (!videoRef.current) {
        alert('Video element not available');
        return;
      }
      if (!modelsLoaded) {
        try {
          await loadFaceApiModels();
        } catch (err) {
          alert('Models not loaded yet');
          return;
        }
      }
      const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.15 });
      const dets = await faceapi.detectAllFaces(videoRef.current, tinyOptions).withFaceLandmarks().withFaceExpressions().withFaceDescriptors();
      setLastDetectionsCount(dets.length);
      if (!dets || dets.length === 0) {
        alert('No faces detected (0)');
        return;
      }
      const lines: string[] = [];
      dets.forEach((d: any, i: number) => {
        const exprs = d.expressions || {};
        const rawBest = Object.entries(exprs).sort((a,b) => (b[1] as number) - (a[1] as number))[0] || ['none', 0];
        const best = rawBest as [string, number];
        const label = faceMatcherRef.current && d.descriptor ? faceMatcherRef.current.findBestMatch(d.descriptor) : null;
        const name = label && label.label && label.label !== 'unknown' ? `${label.label}(${(label.distance||0).toFixed(2)})` : 'unknown';
        lines.push(`#${i+1}: ${best[0]} ${(best[1]*100).toFixed(0)}% • ${name}`);
      });
      alert(`Detected ${dets.length} face(s):\n` + lines.join('\n'));
    } catch (err: any) {
      console.error('runDetection error', err);
      setLastDetectError(err?.message || String(err));
      alert('Detection error: ' + (err?.message || String(err)));
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
    }
    setCameraActive(false);
    setShowCameraModal(false);
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
    }
    setNeedsUserGesture(false);
  };

  // If playback was blocked, try to resume on first user interaction
  useEffect(() => {
    if (!needsUserGesture) return;

    const resume = async () => {
      try {
        await videoRef.current?.play();
        console.log('Playback resumed after user interaction');
        setNeedsUserGesture(false);
        setCameraError('');
      } catch (err) {
        console.warn('Resume after gesture failed', err);
      }
    };

    const handler = () => resume();
    document.addEventListener('click', handler, { once: true });
    document.addEventListener('touchstart', handler, { once: true });
    document.addEventListener('keydown', handler, { once: true });

    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('keydown', handler);
    };
  }, [needsUserGesture]);

  const startFaceDetection = () => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
    }
    
    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current) return;
      // Ensure video has enough data and models are loaded before attempting detection
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.readyState < 2 || !modelsLoaded) {
        console.debug('Skipping detection - readyState:', video.readyState, 'modelsLoaded:', modelsLoaded);
        return;
      }

      // Make sure canvas matches video pixel size for accurate drawing/resizing
      if (video.videoWidth && video.videoHeight) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
      }

      try {
        // Try tiny face detector first, then SSD as a fallback
        // Make tiny detector more sensitive for webcam conditions
        const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.15 });
        console.debug('Running tinyFaceDetector', tinyOptions, 'video size', video.videoWidth, video.videoHeight);
        // include landmarks, expressions and descriptors for recognition
        let detections = await faceapi.detectAllFaces(video, tinyOptions)
          .withFaceLandmarks()
          .withFaceExpressions()
          .withFaceDescriptors();
        console.debug('tiny detections:', detections?.length ?? 0);
        setLastDetectionsCount(detections?.length ?? 0);

        if (!detections || detections.length === 0) {
          console.debug('tiny detector failed, trying ssdMobilenetv1 fallback');
          try {
            detections = await faceapi.detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
              .withFaceLandmarks()
              .withFaceExpressions()
              .withFaceDescriptors();
            console.debug('ssd detections:', detections?.length ?? 0);
            setLastDetectionsCount(detections?.length ?? 0);
          } catch (ssdErr) {
            console.warn('ssdMobilenetv1 detection error', ssdErr);
          }
        }

        if (detections && detections.length > 0) {
          // Get the first detected face
          const detection = detections[0] as any;
          const expressions = detection.expressions as unknown as Record<string, number>;

          console.log('Face detected! Expressions:', expressions);
          setLastDetectError(null);
          
          // Normalize expressions to 0-1 range
          const normalized = Object.entries(expressions).reduce((acc: any, [key, val]) => {
            acc[key] = Math.max(0, Math.min(1, val));
            return acc;
          }, {});

          // Ensure all emotions exist
          const fullEmotions: FaceExpression = {
            happy: normalized.happy || 0,
            sad: normalized.sad || 0,
            angry: normalized.angry || 0,
            neutral: normalized.neutral || 0,
            surprised: normalized.surprised || 0,
            fearful: normalized.fearful || 0,
            disgusted: normalized.disgusted || 0,
            dull: 0 // face-api doesn't have dull, use neutral
          };

          // Find dominant emotion
          const entries = Object.entries(fullEmotions);
          const dominantEntry = entries.reduce((a, b) => (b[1] as number) > (a[1] as number) ? b : a);
          const dominant = dominantEntry[0];
          setCurrentEmotion(dominant);
          setEmotionStats(fullEmotions);
          setDetectionCount(prev => prev + 1);
          // If analysis mode active, record the dominant emotion
          if (analysisModeRef.current) {
            analysisBufferRef.current.push(dominant);
          }

          // We'll perform per-detection recognition when drawing resizedDetections below

          // Draw canvas with detections (use video pixel size)
          const displaySize = { width: canvas.width, height: canvas.height };
          faceapi.matchDimensions(canvas, displaySize);
          const resizedDetections = faceapi.resizeResults(detections, displaySize);

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw face box
              for (const detectionItem of resizedDetections) {
              const box = detectionItem.detection.box;

              // For each detection compute emotion label and recognition name (if available).
              // Prefer FER-2013 model if available for improved accuracy.
              const exprs = (detectionItem.expressions || {}) as Record<string, number>;
              let dominantLabel = dominant; // fallback
              let dominantPct = Math.round((fullEmotions[dominant] || 0) * 100);
              if (ferModel) {
                try {
                  const tmp = document.createElement('canvas');
                  tmp.width = Math.max(1, Math.floor(box.width));
                  tmp.height = Math.max(1, Math.floor(box.height));
                  const tctx = tmp.getContext('2d');
                  if (tctx && videoRef.current) {
                    const scaleX = videoRef.current.videoWidth / displaySize.width;
                    const scaleY = videoRef.current.videoHeight / displaySize.height;
                    const sx = Math.floor(box.x * scaleX);
                    const sy = Math.floor(box.y * scaleY);
                    const sw = Math.floor(box.width * scaleX);
                    const sh = Math.floor(box.height * scaleY);
                    tctx.drawImage(videoRef.current, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
                    // eslint-disable-next-line no-await-in-loop
                    const res = await predictFER(ferModel, tmp);
                    if (res) {
                      dominantLabel = res.label as keyof typeof fullEmotions;
                      dominantPct = Math.round(res.confidence || 0);
                    }
                  }
                } catch (err) {
                  console.warn('FER predict failed', err);
                }
              } else {
                // If expressions exist per-detection, compute its dominant
                if (Object.keys(exprs).length > 0) {
                  const eEntries = Object.entries(exprs);
                  const dEntry = eEntries.reduce((a, b) => (b[1] as number) > (a[1] as number) ? b : a);
                  dominantLabel = dEntry[0];
                  dominantPct = Math.round((dEntry[1] || 0) * 100);
                }
              }

              // Recognition per-detection and scoring
              let displayLabel = '';
              let nameKey = 'unknown';
              try {
                const descr = detectionItem.descriptor as Float32Array | undefined;
                // Auto-enroll first face in-memory as 'Me' if no matcher available
                if (!faceMatcherRef.current && descr) {
                  try {
                    const labeledDesc = new (faceapi as any).LabeledFaceDescriptors('Me', [descr]);
                    labeledDescriptorsRef.current = [labeledDesc];
                    faceMatcherRef.current = new (faceapi as any).FaceMatcher(labeledDescriptorsRef.current, 0.6);
                    console.log('Auto-enrolled first face as Me (in-memory)');
                  } catch (ae) {
                    console.warn('Auto-enroll failed', ae);
                  }
                }

                if (descr && faceMatcherRef.current) {
                  const best = faceMatcherRef.current.findBestMatch(descr);
                  if (best && best.label) {
                    nameKey = best.label || 'unknown';
                    displayLabel = `${best.label} (${(best.distance ?? 0).toFixed(2)})`;
                  }
                }
              } catch (err) {
                console.warn('Per-face recognition failed', err);
              }

              const isRecognized = nameKey && nameKey !== 'unknown';
              ctx.strokeStyle = isRecognized ? '#ef4444' : '#4f46e5';
              ctx.lineWidth = 2;
              ctx.strokeRect(box.x, box.y, box.width, box.height);

              // Compute delta & score for label
              const pointsMapLabel: Record<string, number> = { happy: 2, neutral: 1, surprised: 1, sad: -2, angry: -3, fearful: -1, disgusted: -2, dull: 0 };
              const deltaLabel = Math.round((pointsMapLabel[dominantLabel as keyof typeof pointsMapLabel] || 0) * (dominantPct / 100));
              const currentKnownScore = (recognizedFaces[nameKey]?.score ?? 0) + deltaLabel;
              // Draw label text with computed score and a readable background
              const labelText = `${dominantLabel.toUpperCase()} ${dominantPct}% ${displayLabel} • ${currentKnownScore} pts`;
              ctx.font = 'bold 14px Arial';
              const textWidth = ctx.measureText(labelText).width;
              ctx.fillStyle = 'rgba(0,0,0,0.65)';
              ctx.fillRect(box.x - 4, box.y - 24, textWidth + 8, 20);
              ctx.fillStyle = '#fff';
              ctx.fillText(labelText, box.x, box.y - 10);

              // draw small confidence bar underneath label
              const barX = box.x;
              const barY = box.y - 6;
              const barWidth = Math.max(40, box.width * 0.6);
              const filled = Math.max(2, Math.round((dominantPct / 100) * barWidth));
              ctx.fillStyle = 'rgba(255,255,255,0.15)';
              ctx.fillRect(barX, barY, barWidth, 4);
              ctx.fillStyle = '#10b981';
              ctx.fillRect(barX, barY, filled, 4);

                // Update recognized faces scoring with throttling so we don't double-count steady expressions
                const now = Date.now();
                const localPrevEntry = recognizedFaces[nameKey || 'unknown'] || { lastExpression: dominantLabel, lastUpdated: 0 };
                const shouldUpdateLocal = localPrevEntry.lastExpression !== dominantLabel || (now - (localPrevEntry.lastUpdated || 0) > 800);
                setRecognizedFaces(prev => {
                const label = nameKey || 'unknown';
                const prevEntry = prev[label] || { score: 0, lastExpression: dominantLabel, lastConfidence: dominantPct, detections: 0, counts: { happy:0, sad:0, angry:0, neutral:0, surprised:0, fearful:0, disgusted:0, dull:0 }, lastUpdated: 0 };
                const pointsMap: Record<string, number> = {
                  happy: 2, neutral: 1, surprised: 1, sad: -2, angry: -3, fearful: -1, disgusted: -2, dull: 0
                };
                const delta = Math.round((pointsMap[dominantLabel as keyof typeof pointsMap] || 0) * (dominantPct / 100));
                // Only increment counts/score if the dominant expression changed OR last update was > 800ms ago
                const shouldUpdate = prevEntry.lastExpression !== dominantLabel || (now - (prevEntry.lastUpdated || 0) > 800);
                if (!shouldUpdate) {
                  // Update only lastConfidence and detections/time
                  return {
                    ...prev,
                    [label]: {
                      ...prevEntry,
                      lastConfidence: dominantPct,
                      detections: prevEntry.detections + 1,
                      lastUpdated: now
                    }
                  };
                }
                const newCounts = { ...prevEntry.counts };
                newCounts[dominantLabel] = (newCounts[dominantLabel] || 0) + 1;
                return {
                  ...prev,
                  [label]: {
                    score: prevEntry.score + delta,
                    lastExpression: dominantLabel,
                    lastConfidence: dominantPct,
                    detections: prevEntry.detections + 1,
                    counts: newCounts,
                    lastUpdated: now
                  }
                };
               });

                // Update emotion points (aggregated) only when we should update per-person counts to avoid duplicate adding
                const shouldUpdateGlobal = true; // fallback
                // Read the current prevEntry lastUpdated from recognizedFaces to determine if global update matches per-person throttle
                const existing = recognizedFaces[nameKey || 'unknown'];
                const shouldUpdate = existing ? (existing.lastExpression !== dominantLabel || (Date.now() - (existing.lastUpdated || 0) > 800)) : true;
                if (shouldUpdate) {
                  setEmotionPoints(prev => {
                    const pointsMap: Record<string, number> = {
                      happy: 2, neutral: 1, surprised: 1, sad: -2, angry: -3, fearful: -1, disgusted: -2, dull: 0
                    };
                    const add = Math.round((pointsMap[dominantLabel as keyof typeof pointsMap] || 0) * (dominantPct / 100));
                    return { ...prev, [dominantLabel]: (prev[dominantLabel] || 0) + add };
                  });
                }
            }
          }
        } else {
          // No detections from face-api — try a lightweight TF.js landmarks fallback
          setLastDetectionsCount(0);
          console.debug('face-api returned 0 detections, attempting TF fallback...');
          let handledByTF = false;
          try {
            if (!tfModelRef.current && !tfLoaded) {
              console.debug('Loading TensorFlow face-landmarks-detection from CDN...');
              try {
                    // load TensorFlow runtime by injecting script tag (avoids bundler parsing)
                    await loadExternalScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.21.0/dist/tf.min.js');
                  } catch (e) {
                console.warn('tf script load may already exist or failed:', e);
              }
                  // load face-landmarks-detection UMD script and access the global
                  await loadExternalScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/face-landmarks-detection@0.0.7/dist/face-landmarks-detection.min.js');
                  const fld = (window as any).faceLandmarksDetection || (window as any)['faceLandmarksDetection'];
              if (fld && fld.load) {
                tfModelRef.current = await fld.load(fld.SupportedPackages.mediapipeFacemesh, { maxFaces: 1 });
              }
              setTfLoaded(true);
              console.debug('TF face-landmarks model loaded');
            }

            if (tfModelRef.current) {
              const predictions = await tfModelRef.current.estimateFaces({ input: video });
              console.debug('TF predictions length:', predictions?.length);
              if (predictions && predictions.length > 0) {
                const p = predictions[0];
                const lm: any[] = p.scaledMesh || p.mesh || [];
                const idx = { upperLip: 13, lowerLip: 14, leftCorner: 61, rightCorner: 291 };
                const get = (i: number) => lm[i] || [0,0];
                const a = get(idx.upperLip);
                const b = get(idx.lowerLip);
                const left = get(idx.leftCorner);
                const right = get(idx.rightCorner);
                const dist = (u: any, v: any) => Math.hypot(u[0]-v[0], u[1]-v[1]);
                const mouthOpen = dist(a,b);
                const mouthWidth = dist(left,right) || 1;
                let inferred = 'neutral';
                const ratio = mouthOpen / mouthWidth;
                if (ratio > 0.28) {
                  inferred = 'surprised';
                } else {
                  if (left[1] < a[1] - 2 && right[1] < a[1] - 2) {
                    inferred = 'happy';
                  } else {
                    inferred = 'neutral';
                  }
                }

                console.debug('TF heuristic inferred emotion:', inferred, { mouthOpen, mouthWidth, ratio });
                setCurrentEmotion(inferred);
                const basicStats: FaceExpression = {
                  happy: inferred === 'happy' ? 1 : 0,
                  sad: 0, angry: 0, neutral: inferred === 'neutral' ? 1 : 0,
                  surprised: inferred === 'surprised' ? 1 : 0, fearful: 0, disgusted: 0, dull: 0
                };
                setEmotionStats(basicStats);
                setDetectionCount(prev => prev + 1);
                if (analysisModeRef.current) analysisBufferRef.current.push(inferred);

                // draw box from prediction boundingBox if available
                const canvasCtx = canvas.getContext('2d');
                if (canvasCtx) {
                  canvasCtx.clearRect(0,0,canvas.width,canvas.height);
                  if ((p as any).boundingBox) {
                    const box = (p as any).boundingBox;
                    canvasCtx.strokeStyle = '#22c55e';
                    canvasCtx.lineWidth = 2;
                    canvasCtx.strokeRect(box.topLeft[0], box.topLeft[1], box.bottomRight[0]-box.topLeft[0], box.bottomRight[1]-box.topLeft[1]);
                    canvasCtx.fillStyle = '#22c55e';
                    canvasCtx.font = 'bold 14px Arial';
                    canvasCtx.fillText(inferred.toUpperCase(), box.topLeft[0], box.topLeft[1] - 8);
                  }
                }
                handledByTF = true;

                // Update recognized faces & emotion points for fallback heuristics (use 'unknown')
                const dominantLabelTF = inferred;
                const dominantPctTF = Math.round(Math.min(100, Math.max(30, ratio * 200)));
                const labelTF = 'unknown';
                const nowTF = Date.now();
                const localPrevEntryTF = recognizedFaces[labelTF] || { lastExpression: dominantLabelTF, lastUpdated: 0 };
                const shouldUpdateLocalTF = localPrevEntryTF.lastExpression !== dominantLabelTF || (nowTF - (localPrevEntryTF.lastUpdated || 0) > 800);
                // Update recognizedFaces similar to face-api flow (with throttling)
                setRecognizedFaces(prev => {
                  const now = Date.now();
                  const prevEntry = prev[labelTF] || { score: 0, lastExpression: dominantLabelTF, lastConfidence: dominantPctTF, detections: 0, counts: { happy:0, sad:0, angry:0, neutral:0, surprised:0, fearful:0, disgusted:0, dull:0 }, lastUpdated: 0 };
                  const pointsMap: Record<string, number> = {
                    happy: 2, neutral: 1, surprised: 1, sad: -2, angry: -3, fearful: -1, disgusted: -2, dull: 0
                  };
                  const delta = Math.round((pointsMap[dominantLabelTF as keyof typeof pointsMap] || 0) * (dominantPctTF / 100));
                  const shouldUpdate = prevEntry.lastExpression !== dominantLabelTF || (now - (prevEntry.lastUpdated || 0) > 800);
                  if (!shouldUpdate) {
                    return { ...prev, [labelTF]: { ...prevEntry, lastConfidence: dominantPctTF, detections: prevEntry.detections + 1, lastUpdated: now } };
                  }
                  const newCounts = { ...prevEntry.counts };
                  newCounts[dominantLabelTF] = (newCounts[dominantLabelTF] || 0) + 1;
                  return { ...prev, [labelTF]: { score: prevEntry.score + delta, lastExpression: dominantLabelTF, lastConfidence: dominantPctTF, detections: prevEntry.detections + 1, counts: newCounts, lastUpdated: now } };
                });
                if (shouldUpdateLocal) {
                  const pointsMapLocal: Record<string, number> = { happy: 2, neutral: 1, surprised: 1, sad: -2, angry: -3, fearful: -1, disgusted: -2, dull: 0 };
                  const deltaLocal = Math.round((pointsMapLocal[dominantLabel as keyof typeof pointsMapLocal] || 0) * (dominantPct / 100));
                  postEventToServer({ face_label: nameKey || 'unknown', emotion: dominantLabel, confidence: dominantPct, delta: deltaLocal, timestamp: new Date().toISOString() });
                }
                if (shouldUpdateLocalTF) {
                  const pointsMapTF: Record<string, number> = { happy: 2, neutral: 1, surprised: 1, sad: -2, angry: -3, fearful: -1, disgusted: -2, dull: 0 };
                  const deltaTF = Math.round((pointsMapTF[dominantLabelTF as keyof typeof pointsMapTF] || 0) * (dominantPctTF / 100));
                  postEventToServer({ face_label: labelTF, emotion: dominantLabelTF, confidence: dominantPctTF, delta: deltaTF, timestamp: new Date().toISOString() });
                }
                

                // Update global emotionPoints with throttle logic (same as recognizedFaces usage)
                setEmotionPoints(prev => {
                  const pointsMap: Record<string, number> = {
                    happy: 2, neutral: 1, surprised: 1, sad: -2, angry: -3, fearful: -1, disgusted: -2, dull: 0
                  };
                  const add = Math.round((pointsMap[dominantLabelTF as keyof typeof pointsMap] || 0) * (dominantPctTF / 100));
                  return { ...prev, [dominantLabelTF]: (prev[dominantLabelTF] || 0) + add };
                });
              }
            }
          } catch (tfErr) {
            console.warn('TF fallback error:', tfErr);
          }

          if (!handledByTF) {
            // No face detected - reset to default
            setCurrentEmotion('neutral');
            setEmotionStats({
              happy: 0, sad: 0, angry: 0, neutral: 0,
              surprised: 0, fearful: 0, disgusted: 0, dull: 0
            });
            // Clear canvas
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
          }
        }
      } catch (error) {
        console.error('Face detection error:', error);
      }
    }, 500); // Detection every 500ms (optimized for speed)
  };

  // Helper: Load remote script via plain <script> tag (avoids bundler parse errors)
  const loadExternalScript = (url: string) => new Promise<void>((resolve, reject) => {
    try {
      const existing = document.querySelector(`script[src="${url}"]`);
      if (existing) return resolve();
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    } catch (err) {
      reject(err);
    }
  });

  // Start a short analysis session that aggregates dominant emotions
  const startAnalysis = (seconds = 10) => {
    if (isAnalyzing) return;
    analysisBufferRef.current = [];
    analysisModeRef.current = true;
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisResults('');

    const start = Date.now();
    // progress ticker
    const progressInterval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      setAnalysisProgress(Math.min(100, Math.round((elapsed / seconds) * 100)));
    }, 200);

    // stop after duration
    analysisTimeoutRef.current = setTimeout(() => {
      analysisModeRef.current = false;
      setIsAnalyzing(false);
      setAnalysisProgress(100);
      clearInterval(progressInterval);

      // compute summary
      const counts: Record<string, number> = {};
      analysisBufferRef.current.forEach(e => counts[e] = (counts[e] || 0) + 1);
      const total = analysisBufferRef.current.length || 1;
      const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
      if (sorted.length === 0) {
        setAnalysisResults('No faces detected during analysis. Please try again.');
      } else {
        const top = sorted.slice(0,3).map(([emo, cnt]) => `${emo} (${Math.round((cnt/total)*100)}%)`).join(', ');
        setAnalysisResults(`Detected emotions: ${top}. Total samples: ${total}.`);
      }
    }, seconds * 1000);
  };

  const cancelAnalysis = () => {
    if (analysisTimeoutRef.current) {
      clearTimeout(analysisTimeoutRef.current);
      analysisTimeoutRef.current = null;
    }
    analysisModeRef.current = false;
    setIsAnalyzing(false);
    setAnalysisProgress(0);
    setAnalysisResults('Analysis cancelled.');
  };

  const emojiForEmotion = (emotion: string) => {
    const map: { [k: string]: string } = {
      happy: '😊',
      sad: '😢',
      angry: '😠',
      neutral: '😐',
      surprised: '😲',
      fearful: '😨',
      disgusted: '🤢',
      dull: '😑'
    };
    return map[emotion] || '🙂';
  };



  const handleNextPage = () => {
    if (currentPage < estimatedPageCount) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleTextToSpeech = () => {
    if (contentRef.current) {
      const text = contentRef.current.innerText;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = studentLanguage === 'Tamil' ? 'ta-IN' : 'en-IN';
      speechSynthesis.speak(utterance);
    }
  };

  const triggerGame = () => {
    setShowGame(true);
    setIsReading(false);
  };

  const resumeReading = () => {
    setShowGame(false);
    setIsReading(true);
  };

  return (
    <>
      {/* Main Split View Container */}
      <div className="fixed inset-0 bg-gradient-to-br from-gray-50 to-gray-100 z-50">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-pink-600 p-4 flex items-center justify-between shadow-lg">
          <div>
            <h2 className="text-2xl font-bold text-white">{fileName}</h2>
            <p className="text-indigo-100 text-sm">
              Page {currentPage} of {estimatedPageCount} | Emotional Status: <span className="font-semibold capitalize">{currentEmotion}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white hover:bg-opacity-20 p-2 rounded-lg transition-all"
          >
            <X size={24} />
          </button>
        </div>

        {/* Main Content Area - Split Layout */}
        <div className="flex h-[calc(100vh-100px)] gap-4 p-4 overflow-hidden">
          {/* Left Side: Reading Content */}
          <div className="flex-1 flex flex-col bg-white rounded-lg shadow-lg overflow-hidden">
            {/* Content Display */}
            <div
              ref={contentRef}
              className="flex-1 overflow-y-auto p-6 text-black text-base leading-relaxed"
              style={{
                fontSize: '16px',
                color: '#000000',
                lineHeight: '1.8',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              <ReactMarkdown
                components={{
                  h1: ({ node, ...props }) => (
                    <h1 className="text-3xl font-bold text-black mb-4 mt-6" {...props} />
                  ),
                  h2: ({ node, ...props }) => (
                    <h2 className="text-2xl font-bold text-black mb-3 mt-5" {...props} />
                  ),
                  h3: ({ node, ...props }) => (
                    <h3 className="text-xl font-bold text-black mb-2 mt-4" {...props} />
                  ),
                  p: ({ node, ...props }) => (
                    <p className="text-black mb-3" {...props} />
                  ),
                  strong: ({ node, ...props }) => (
                    <strong className="text-black font-bold bg-yellow-100 px-1 rounded" {...props} />
                  ),
                  em: ({ node, ...props }) => (
                    <em className="text-black italic" {...props} />
                  ),
                  ul: ({ node, ...props }) => (
                    <ul className="list-disc list-inside ml-4 mb-3 text-black" {...props} />
                  ),
                  ol: ({ node, ...props }) => (
                    <ol className="list-decimal list-inside ml-4 mb-3 text-black" {...props} />
                  ),
                  li: ({ node, ...props }) => (
                    <li className="text-black mb-1" {...props} />
                  ),
                  blockquote: ({ node, ...props }) => (
                    <blockquote
                      className="border-l-4 border-indigo-500 bg-indigo-50 pl-4 py-2 my-3 text-black italic"
                      {...props}
                    />
                  ),
                  table: ({ node, ...props }) => (
                    <table className="w-full border-collapse border border-gray-300 my-3" {...props} />
                  ),
                  tr: ({ node, ...props }) => (
                    <tr className="border border-gray-300" {...props} />
                  ),
                  td: ({ node, ...props }) => (
                    <td className="border border-gray-300 p-2 text-black" {...props} />
                  ),
                  th: ({ node, ...props }) => (
                    <th className="border border-gray-300 p-2 bg-gray-100 text-black font-bold" {...props} />
                  ),
                  code: ({ node, ...props }) => (
                    <code className="bg-gray-100 text-black px-2 py-1 rounded font-mono" {...props} />
                  ),
                  pre: ({ node, ...props }) => (
                    <pre className="bg-gray-800 text-white p-4 rounded overflow-x-auto mb-3" {...props} />
                  )
                }}
              >
                {htmlContent}
              </ReactMarkdown>
            </div>

            {/* Reading Controls */}
            <div className="border-t border-gray-200 bg-gray-50 p-4 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 1}
                  className="p-2 hover:bg-gray-200 rounded-lg disabled:opacity-50 transition-all"
                >
                  <ChevronLeft size={20} className="text-black" />
                </button>

                <input
                  type="range"
                  min="1"
                  max={estimatedPageCount}
                  value={currentPage}
                  onChange={(e) => setCurrentPage(parseInt(e.target.value))}
                  className="w-48 h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                />

                <button
                  onClick={handleNextPage}
                  disabled={currentPage === estimatedPageCount}
                  className="p-2 hover:bg-gray-200 rounded-lg disabled:opacity-50 transition-all"
                >
                  <ChevronRight size={20} className="text-black" />
                </button>

                <span className="text-black font-semibold ml-2">
                  Page {currentPage}/{estimatedPageCount}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleTextToSpeech}
                  className="flex items-center gap-2 px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all"
                >
                  <Volume2 size={18} /> Read Aloud
                </button>

                <button
                  onClick={triggerGame}
                  className="flex items-center gap-2 px-3 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-all"
                >
                  <Zap size={18} /> Take a Break
                </button>

                <button
                  onClick={onDownload}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all"
                >
                  <Download size={18} /> Download
                </button>
              </div>
            </div>
          </div>

          {/* Right Side: Live Camera with Mood Analysis */}
          <div className="w-80 flex flex-col gap-4 h-full">
            {/* Camera Feed Container */}
            <div className="flex-1 bg-black rounded-xl overflow-hidden shadow-2xl flex flex-col">
              {/* Camera Status Header */}
              <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-2 flex items-center justify-between">
                <span className="text-white font-bold text-sm flex items-center gap-2">
                  📷 {cameraActive ? '✓ Live' : '⏳ Loading...'}
                </span>
                <span className="text-white text-xs font-semibold">{detectionCount} frames</span>
              </div>

              {/* Live Camera Feed */}
              <div className="flex-1 relative flex items-center justify-center overflow-hidden">
                  <>
                    {/* Always render video & canvas so refs exist even when inactive */}
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      autoPlay
                      playsInline
                      muted
                    />
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 w-full h-full"
                      width={640}
                      height={480}
                    />

                    {/* If camera not active, show big enable UI */}
                    {!cameraActive && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                        <p className="text-lg text-white font-semibold mb-3">🎥 Camera not active</p>
                        <p className="text-sm text-gray-200 mb-4">Please allow camera access and click to start the live feed.</p>
                        <div className="flex flex-col gap-2 items-center">
                          <button
                            onClick={async () => { await attachAndPlay(); }}
                            className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg w-48"
                          >
                            Enable Camera
                          </button>
                          <button
                            onClick={() => initializeCamera()}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg w-40 mt-2"
                          >
                            Retry Permissions
                          </button>
                        </div>

                        <div className="mt-4 text-xs text-gray-300">
                            <div>Models loaded: {modelsLoaded ? 'yes' : 'no'}</div>
                            <div>Video readyState: {videoRef.current?.readyState ?? 0}</div>
                            <div>Video paused: {videoRef.current?.paused ? 'yes' : 'no'}</div>
                            <div>Last detections: {lastDetectionsCount ?? '–'}</div>
                            {lastDetectError && <div className="text-xs text-red-300">Detect error: {lastDetectError}</div>}
                        </div>
                      </div>
                    )}

                    {/* Playback / Error Overlay (shows when play blocked or error) */}
                    {(cameraError || needsUserGesture || (videoRef.current && (videoRef.current.paused || videoRef.current.readyState < 2))) && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-black bg-opacity-60 rounded-lg p-4 text-center">
                          {cameraError ? (
                            <>
                              <p className="text-white mb-2">{cameraError}</p>
                              <button
                                onClick={() => initializeCamera()}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg"
                              >
                                Retry Camera
                              </button>
                            </>
                          ) : (
                            <>
                              <p className="text-white mb-2">Click to start camera</p>
                              <button
                                onClick={async () => {
                                  try {
                                    await attachAndPlay();
                                    console.log('Playback resumed by user gesture');
                                  } catch (err) {
                                    console.warn('Playback resume failed', err);
                                    setCameraError('Playback blocked. Please allow camera or interact with the page.');
                                  }
                                }}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg"
                              >
                                Start Camera
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Mood Overlay on Camera */}
                    <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-70 rounded-lg p-3 backdrop-blur-sm">
                      <div className="flex items-center gap-3">
                        <div className="text-3xl">{emojiForEmotion(currentEmotion)}</div>
                        <div className="flex-1">
                          <p className="text-white text-xs font-semibold uppercase">Current Mood</p>
                          <p className="text-white text-lg font-bold capitalize">{currentEmotion}</p>
                        </div>
                      </div>
                    </div>
                  </>
                </div>
                <div className="bg-slate-900 px-4 py-3 border-t border-slate-700">
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(emotionStats).slice(0, 4).map(([emotion, value]) => (
                    <div key={emotion} className="text-center">
                      <p className="text-xs text-gray-400 capitalize font-semibold mb-1">{emotion}</p>
                      <p className="text-sm font-bold text-white">{(value * 100).toFixed(0)}%</p>
                    </div>
                  ))}
                </div>

                {/* Recognized Faces & Points */}
                <div className="bg-slate-800 px-4 py-3 border-t border-slate-700 mt-2 rounded-lg">
                  <p className="text-xs font-semibold text-gray-300 uppercase mb-2">Recognized Faces</p>
                  <div className="space-y-2">
                    {Object.entries(recognizedFaces).length === 0 ? (
                      <p className="text-xs text-gray-400">No faces recognized yet</p>
                    ) : (
                      Object.entries(recognizedFaces).map(([name, data]) => (
                        <div key={name} className="mb-2">
                          <div className="flex items-center justify-between text-sm text-white">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold">{name[0]?.toUpperCase() ?? 'U'}</div>
                              <div className="text-xs">
                                <div className="font-semibold">{name}</div>
                                <div className="text-gray-400 text-xs">{data.lastExpression} · {Math.round(data.lastConfidence)}% · {data.detections} detections</div>
                              </div>
                            </div>
                            <div className="text-sm font-bold text-green-400">{data.score}</div>
                          </div>

                          <div className="mt-2 w-full grid grid-cols-4 gap-2 text-xs text-gray-200">
                            {Object.entries(data.counts || {}).map(([emo, cnt]) => (
                              <div key={emo} className="text-center">
                                <div className="font-semibold capitalize">{emo}</div>
                                <div className="text-xs">{cnt}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-3">
                    <p className="text-xs font-semibold text-gray-300 uppercase mb-2">Emotion Points</p>
                    <div className="grid grid-cols-4 gap-2 text-xs text-gray-300">
                      {Object.entries(emotionPoints).map(([emo, pts]) => (
                        <div key={emo} className="text-center">
                          <div className="font-semibold text-white">{emo}</div>
                          <div className="text-gray-400">{pts}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {Object.entries(emotionStats).slice(4).map(([emotion, value]) => (
                    <div key={emotion} className="text-center">
                      <p className="text-xs text-gray-400 capitalize font-semibold mb-1">{emotion}</p>
                      <p className="text-sm font-bold text-white">{(value * 100).toFixed(0)}%</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => enrollFace('Me')}
                  className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all text-sm disabled:opacity-40"
                  disabled={!modelsLoaded || !cameraActive}
                  title={!modelsLoaded ? 'Model loading...' : (!cameraActive ? 'Camera not active' : 'Enroll as Me')}
                >
                  Enroll as Me
                </button>
                <button
                  onClick={() => runDetection()}
                  className="px-3 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300 text-sm disabled:opacity-40"
                  disabled={!modelsLoaded || !cameraActive}
                  title={!modelsLoaded ? 'Model loading...' : (!cameraActive ? 'Camera not active' : 'Run single detection')}
                >
                  Test
                </button>
              </div>
              <div className="flex-1" />
              <button
                onClick={stopCamera}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all font-semibold text-sm"
              >
                Stop
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AI Game Modal */}
      {showGame && (
        <AIReliefGame
          studentLanguage={studentLanguage}
          currentEmotion={currentEmotion}
          onResume={resumeReading}
        />
      )}

      {/* Camera Mood Analysis Modal */}
      {showCameraModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-6 flex items-center justify-between">
              <h2 className="text-3xl font-bold text-white">📷 Real-Time Mood Analysis</h2>
              <button
                onClick={stopCamera}
                className="text-white hover:bg-white hover:bg-opacity-20 p-2 rounded-lg transition-all"
              >
                <X size={32} />
              </button>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-6 flex gap-6">
              {/* Left: Camera Feed */}
              <div className="flex-1 flex flex-col relative">
                <div className="bg-black rounded-xl overflow-hidden flex-1 flex items-center justify-center min-h-96 relative">
                  {cameraActive ? (
                    <>
                      <video
                        ref={videoRef}
                        className="absolute inset-0 w-full h-full object-cover"
                        autoPlay
                        playsInline
                        muted
                      />
                      <canvas
                        ref={canvasRef}
                        className="absolute inset-0 w-full h-full"
                        width={640}
                        height={480}
                      />
                    </>
                  ) : (
                    <div className="text-white text-center">
                      <p className="text-2xl font-bold mb-4">🎥 Requesting Camera Access...</p>
                      {cameraError && (
                        <p className="text-red-400 text-lg mb-4">{cameraError}</p>
                      )}
                      <button
                        onClick={() => {
                          initializeCamera();
                        }}
                        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold text-lg"
                      >
                        Try Again
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Mood Analysis */}
              <div className="w-96 flex flex-col gap-4">
                {/* Large Current Emotion */}
                <div className="bg-gradient-to-br from-purple-100 to-pink-100 rounded-xl p-6 border-2 border-purple-300 shadow-lg">
                  <p className="text-sm font-bold text-gray-700 uppercase mb-2">Current Mood</p>
                  <div className="text-6xl mb-4">{emojiForEmotion(currentEmotion)}</div>
                  <p className="text-4xl font-bold text-gray-800 capitalize">{currentEmotion}</p>
                </div>

                {/* Detection Stats */}
                <div className="bg-blue-50 rounded-xl p-4 border-2 border-blue-300">
                  <p className="text-sm font-bold text-gray-700 uppercase mb-2">Analysis Stats</p>
                  <p className="text-2xl font-bold text-blue-600">Detections: {detectionCount}</p>
                  <p className="text-sm text-gray-600 mt-2">Updates every 500ms</p>
                  <div className="mt-3 flex gap-2">
                    {!isAnalyzing ? (
                      <button
                        onClick={() => startAnalysis(10)}
                        className="px-3 py-2 bg-green-600 text-white rounded-lg font-semibold"
                      >
                        Analyze 10s
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => cancelAnalysis()}
                          className="px-3 py-2 bg-yellow-600 text-white rounded-lg font-semibold"
                        >
                          Cancel
                        </button>
                        <div className="flex-1 flex items-center gap-2">
                          <div className="text-xs text-gray-700 w-14">{analysisProgress}%</div>
                          <div className="flex-1 bg-gray-200 h-3 rounded overflow-hidden">
                            <div className="bg-gradient-to-r from-green-400 to-blue-500 h-full" style={{ width: `${analysisProgress}%` }} />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  {analysisResults && (
                    <p className="mt-3 text-sm text-gray-700">{analysisResults}</p>
                  )}
                </div>

                {/* Emotion Breakdown */}
                <div className="bg-gray-50 rounded-xl p-4 border-2 border-gray-300 flex-1 overflow-y-auto">
                  <p className="text-sm font-bold text-gray-700 uppercase mb-3">Emotion Breakdown</p>
                  <div className="space-y-3">
                    {Object.entries(emotionStats).map(([emotion, value]) => {
                      const percentage = Math.round(value * 100);
                      return (
                        <div key={emotion}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-lg font-semibold text-gray-700 capitalize">
                              {emojiForEmotion(emotion)} {emotion}
                            </span>
                            <span className="text-lg font-bold text-gray-800">{percentage}%</span>
                          </div>
                          <div className="w-full bg-gray-300 rounded-full h-4 overflow-hidden">
                            <div
                              className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-300"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Recognized Faces */}
                <div className="bg-white rounded-xl p-4 border-2 border-gray-200 mt-3">
                  <p className="text-sm font-bold text-gray-700 uppercase mb-2">Recognized Faces</p>
                  {Object.entries(recognizedFaces).length === 0 ? (
                    <p className="text-xs text-gray-500">No faces recognized yet</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(recognizedFaces).map(([name, data]) => (
                        <div key={name} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-semibold">{name[0]?.toUpperCase() ?? 'U'}</div>
                            <div>
                              <div className="font-semibold text-gray-700">{name}</div>
                              <div className="text-xs text-gray-500">{data.lastExpression} · {Math.round(data.lastConfidence)}% · {data.detections} detections</div>
                            </div>
                          </div>
                          <div className="text-lg font-bold text-green-600">{data.score}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Emotion Points */}
                <div className="bg-white rounded-xl p-4 border-2 border-gray-200 mt-3">
                  <p className="text-sm font-bold text-gray-700 uppercase mb-2">Emotion Points</p>
                  <div className="grid grid-cols-4 gap-3 text-sm text-gray-600">
                    {Object.entries(emotionPoints).map(([emo, pts]) => (
                      <div key={emo} className="text-center">
                        <div className="text-xs text-gray-500 capitalize">{emo}</div>
                        <div className="font-semibold text-gray-800">{pts}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Close Button */}
                <button
                  onClick={stopCamera}
                  className="w-full px-6 py-4 bg-red-500 text-white font-bold text-lg rounded-lg hover:bg-red-600 transition-all shadow-lg"
                >
                  ✕ Close Camera
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ReadingViewWithCamera;
