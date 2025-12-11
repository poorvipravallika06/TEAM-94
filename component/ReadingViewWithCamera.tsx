import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Volume2, Download, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import AIReliefGame from './AIReliefGame.tsx';

interface ReadingViewWithCameraProps {
  htmlContent: string;
  fileName: string;
  studentLanguage?: string;
  onClose: () => void;
  onDownload: () => void;
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
  onDownload
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [estimatedPageCount, setEstimatedPageCount] = useState(1);
  const [showGame, setShowGame] = useState(false);
  const [isReading, setIsReading] = useState(true);
  const [showCameraModal, setShowCameraModal] = useState(false);
  
  // Camera and emotion detection state
  const [cameraActive, setCameraActive] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<string>('neutral');
  const [emotionStats, setEmotionStats] = useState<FaceExpression>({
    happy: 0, sad: 0, angry: 0, neutral: 0,
    surprised: 0, fearful: 0, disgusted: 0, dull: 0
  });
  const [detectionCount, setDetectionCount] = useState(0);
  const [cameraError, setCameraError] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

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
    // Don't auto-initialize, wait for user click
    return () => {
      stopCamera();
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
    };
  }, []);

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

      console.log('Camera stream obtained:', stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Play video when ready
        videoRef.current.onloadedmetadata = () => {
          console.log('Video metadata loaded');
          videoRef.current!.play()
            .then(() => {
              console.log('Video now playing');
              setCameraActive(true);
              startFaceDetection();
            })
            .catch(err => {
              console.error('Play error:', err);
              setCameraError('Failed to play video stream');
            });
        };
        
        // Fallback if metadata event doesn't fire
        const timeoutId = setTimeout(() => {
          if (videoRef.current && videoRef.current.readyState >= 2) {
            videoRef.current.play().catch(() => {});
            setCameraActive(true);
            startFaceDetection();
          }
        }, 3000);
        
        videoRef.current.addEventListener('play', () => {
          clearTimeout(timeoutId);
        }, { once: true });
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
  };

  const startFaceDetection = () => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
    }
    
    detectionIntervalRef.current = setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return;
      // Ensure video has enough data before attempting detection
      if (videoRef.current.readyState < 2) return;

      try {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Draw video frame to canvas
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

        // Simulate emotion detection
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const emotions = simulateEmotionDetection(imageData);

        // Update emotion stats
        const entries = Object.entries(emotions);
        const dominantEntry = entries.reduce((a, b) => (b[1] as number) > (a[1] as number) ? b : a);
        const dominant = dominantEntry[0];

        setCurrentEmotion(dominant);
        setEmotionStats(emotions);
        setDetectionCount(prev => prev + 1);

        // Draw face rectangle and emotion on canvas
        drawEmotionOverlay(ctx, dominant as string, emotions);
      } catch (error) {
        console.error('Face detection error:', error);
      }
    }, 500); // Detection every 500ms
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

  const simulateEmotionDetection = (imageData: ImageData): FaceExpression => {
    // Simulate emotion detection based on image data brightness
    const data = imageData.data;
    let brightness = 0;

    for (let i = 0; i < data.length; i += 4) {
      brightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    brightness = brightness / (data.length / 4);

    // Simulate different emotions based on brightness and randomness
    const random = Math.random();
    const ratio = brightness / 255;

    return {
      happy: Math.max(0, (ratio * 0.3 + random * 0.2)),
      sad: Math.max(0, ((1 - ratio) * 0.2 + random * 0.15)),
      angry: Math.max(0, ((1 - ratio) * 0.15 + random * 0.15)),
      neutral: Math.max(0, (0.5 + random * 0.3)),
      surprised: Math.max(0, (random * 0.2)),
      fearful: Math.max(0, ((1 - ratio) * 0.1 + random * 0.1)),
      disgusted: Math.max(0, (random * 0.1)),
      dull: Math.max(0, ((1 - ratio) * 0.25 + random * 0.15))
    };
  };

  const drawEmotionOverlay = (ctx: CanvasRenderingContext2D, emotion: string, stats: FaceExpression) => {
    // Draw emotion label and stats
    const emotionColors: { [key: string]: string } = {
      happy: '#10b981',
      sad: '#ef4444',
      angry: '#f97316',
      neutral: '#6b7280',
      surprised: '#f59e0b',
      fearful: '#8b5cf6',
      disgusted: '#ec4899',
      dull: '#6366f1'
    };

    ctx.fillStyle = emotionColors[emotion] || '#6b7280';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`Emotion: ${emotion.toUpperCase()}`, 10, 30);

    // Draw emotion confidence bars
    let yPos = 50;
    Object.entries(stats).forEach(([key, value]) => {
      ctx.fillStyle = '#333';
      ctx.font = '12px Arial';
      ctx.fillText(`${key}: ${(value * 100).toFixed(0)}%`, 10, yPos);
      yPos += 20;
    });
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

          {/* Right Side: Camera and Emotion Analysis */}
          <div className="w-80 flex flex-col gap-4">
            {/* Camera Button */}
            <button
              onClick={() => {
                setShowCameraModal(true);
                setTimeout(() => initializeCamera(), 300);
              }}
              className="w-full px-6 py-4 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold text-lg rounded-lg hover:from-blue-600 hover:to-cyan-600 transition-all shadow-lg"
            >
              📷 Enable Camera & Analyze Mood
            </button>

            {/* Emotion Stats Panel */}
            <div className="bg-white rounded-lg shadow-lg p-4 flex-1 overflow-y-auto">
              <h3 className="text-lg font-bold text-black mb-3">Emotion Analysis</h3>

              {/* Current Emotion Large Display */}
              <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-indigo-100 to-pink-100 border-2 border-indigo-300">
                <p className="text-sm text-gray-600 font-semibold">Current Emotion</p>
                <p className="text-2xl font-bold text-black capitalize">{emojiForEmotion(currentEmotion)} {currentEmotion}</p>
              </div>

              {/* Emotion Bars */}
              <div className="space-y-2">
                {Object.entries(emotionStats).map(([emotion, value]) => (
                  <div key={emotion}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-semibold text-gray-700 capitalize">{emotion}</span>
                      <span className="text-xs font-bold text-gray-600">{(value * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          emotion === 'happy'
                            ? 'bg-green-500'
                            : emotion === 'sad'
                            ? 'bg-red-500'
                            : emotion === 'angry'
                            ? 'bg-orange-500'
                            : emotion === 'neutral'
                            ? 'bg-gray-500'
                            : emotion === 'surprised'
                            ? 'bg-yellow-500'
                            : emotion === 'fearful'
                            ? 'bg-purple-500'
                            : emotion === 'disgusted'
                            ? 'bg-pink-500'
                            : 'bg-indigo-500'
                        }`}
                        style={{ width: `${value * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Detection Stats */}
              <div className="mt-4 pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-600">
                  <span className="font-semibold">Detections:</span> {detectionCount}
                </p>
                <p className="text-xs text-gray-600">
                  <span className="font-semibold">Reading Status:</span>{' '}
                  {isReading ? 'Active' : 'Break Time'}
                </p>
              </div>
            </div>

            {/* Close Camera Button */}
            <button
              onClick={stopCamera}
              className="w-full px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all font-semibold"
            >
              Close Camera
            </button>
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
              <div className="flex-1 flex flex-col">
                <div className="bg-black rounded-xl overflow-hidden flex-1 flex items-center justify-center min-h-96">
                  {cameraActive ? (
                    <>
                      <video
                        ref={videoRef}
                        className="w-full h-full object-cover"
                        autoPlay
                        playsInline
                        muted
                      />
                      <canvas
                        ref={canvasRef}
                        className="hidden"
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
