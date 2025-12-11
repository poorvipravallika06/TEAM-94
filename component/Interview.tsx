
import React, { useState, useEffect, useRef } from 'react';
import { getInterviewQuiz } from '../services/geminiServices';
import { Play, AlertTriangle, ShieldAlert, Timer, CheckCircle, XCircle, LogOut, Video, Mic, Maximize } from 'lucide-react';

const ROUND_TYPES = ['Technical', 'DSA', 'Non-Technical'];
const TOPICS = {
    Technical: ['Java', 'Python', 'React', 'Node.js', 'SQL'],
    DSA: ['Arrays', 'Trees', 'Graphs', 'DP'],
    'Non-Technical': ['Aptitude', 'Logical Reasoning', 'Situational']
};

interface Question {
    id: number;
    question: string;
    options: string[];
    correctIndex: number;
}

const Interview: React.FC = () => {
    // Setup State
    const [roundType, setRoundType] = useState('Technical');
    const [topic, setTopic] = useState('Java');
    const [difficulty, setDifficulty] = useState('Intermediate');
    const [isTestActive, setIsTestActive] = useState(false);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [currentQIndex, setCurrentQIndex] = useState(0);
    const [score, setScore] = useState(0);
    const [timeLeft, setTimeLeft] = useState(600); // 10 mins total
    const [malpracticeCount, setMalpracticeCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [testFinished, setTestFinished] = useState(false);
    const [hasPermissions, setHasPermissions] = useState(false);
    const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Helper to stop all media tracks immediately
    const stopMedia = () => {
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            setMediaStream(null);
            setHasPermissions(false);
        }
    };

    // Permission Handling
    const requestPermissions = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setMediaStream(stream);
            setHasPermissions(true);
        } catch (err) {
            console.error(err);
            alert("Camera and Microphone permissions are required for the interview. Please allow access.");
        }
    };

    // Attach stream to video element whenever view changes or stream updates
    useEffect(() => {
        if (videoRef.current && mediaStream) {
            videoRef.current.srcObject = mediaStream;
        }
    }, [mediaStream, isTestActive, testFinished]);

    // Cleanup stream on unmount
    useEffect(() => {
        return () => {
            stopMedia();
        };
    }, []);

    const finishTest = () => {
        stopMedia(); // Turn off camera immediately
        setIsTestActive(false);
        setTestFinished(true);
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(e => console.log(e));
        }
    };

    // Malpractice Detection (Immediate Stop)
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden && isTestActive) {
                // Immediate termination
                alert("TEST TERMINATED: You navigated away from the test window.");
                finishTest();
            }
        };

        if (isTestActive) {
            document.addEventListener("visibilitychange", handleVisibilityChange);
            // Enter Fullscreen
            containerRef.current?.requestFullscreen().catch(err => console.log(err));
        }

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [isTestActive]);

    // Timer
    useEffect(() => {
        if (isTestActive && timeLeft > 0) {
            const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
            return () => clearInterval(timer);
        } else if (timeLeft === 0 && isTestActive) {
            finishTest();
        }
    }, [isTestActive, timeLeft]);

    const startTest = async () => {
        if (!hasPermissions) {
            alert("Please click 'Allow' in the System Check panel to enable Camera & Mic first.");
            return;
        }
        setLoading(true);
        try {
            const quiz = await getInterviewQuiz(roundType, topic, difficulty);
            if (quiz && quiz.length > 0) {
                setQuestions(quiz);
                setIsTestActive(true);
                setTestFinished(false);
                setScore(0);
                setCurrentQIndex(0);
                setTimeLeft(300); // 5 mins for 5 questions
                setMalpracticeCount(0);
            } else {
                alert("Failed to generate questions. Please try again.");
            }
        } catch (e) {
            console.error(e);
            alert("An error occurred while starting the test.");
        } finally {
            setLoading(false);
        }
    };

    const handleAnswer = (optionIndex: number) => {
        if (optionIndex === questions[currentQIndex].correctIndex) {
            setScore(prev => prev + 1);
        }

        if (currentQIndex < questions.length - 1) {
            setCurrentQIndex(prev => prev + 1);
        } else {
            finishTest();
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    // --- Render ---

    if (isTestActive) {
        return (
            <div ref={containerRef} className="fixed inset-0 bg-slate-900 text-white z-50 flex flex-col p-8 overflow-y-auto">
                {/* Test Header */}
                <div className="flex justify-between items-center mb-8 bg-slate-800 p-4 rounded-xl border border-slate-700 shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 text-red-400 font-bold animate-pulse">
                            <span className="w-3 h-3 bg-red-500 rounded-full"></span> REC
                        </div>
                        <div className="bg-slate-700 px-4 py-1 rounded text-sm font-mono flex items-center gap-2">
                             <Timer className="h-4 w-4" /> {formatTime(timeLeft)}
                        </div>
                        <div className="bg-slate-700 px-4 py-1 rounded text-sm text-yellow-400 font-bold flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4" /> Strict Proctoring Active
                        </div>
                    </div>
                    <button onClick={finishTest} className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded font-bold text-sm flex items-center gap-2">
                        <LogOut className="h-4 w-4" /> Exit Test
                    </button>
                </div>

                <div className="flex flex-col lg:flex-row flex-1 gap-8">
                    {/* Question Area */}
                    <div className="flex-1 flex flex-col justify-center max-w-4xl mx-auto w-full">
                        <div className="mb-6">
                            <span className="text-slate-400 text-sm uppercase tracking-wider font-bold">Question {currentQIndex + 1} / {questions.length}</span>
                            <h2 className="text-2xl md:text-3xl font-bold mt-2 leading-relaxed">{questions[currentQIndex].question}</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {questions[currentQIndex].options.map((opt, idx) => (
                                <button 
                                    key={idx}
                                    onClick={() => handleAnswer(idx)}
                                    className="p-6 bg-slate-800 border-2 border-slate-700 rounded-xl hover:border-indigo-500 hover:bg-slate-700 text-left transition-all font-medium text-lg"
                                >
                                    <span className="bg-slate-600 px-2 py-0.5 rounded text-sm mr-3 font-bold">{String.fromCharCode(65+idx)}</span>
                                    {opt}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Camera Feed */}
                    <div className="w-full lg:w-64 flex flex-col gap-4 shrink-0">
                        <div className="bg-black rounded-xl overflow-hidden border-2 border-slate-700 shadow-xl relative aspect-video">
                             <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                             <div className="absolute bottom-2 left-2 bg-black/60 px-2 rounded text-xs">Live Feed</div>
                        </div>
                        <div className="p-4 bg-slate-800 rounded-xl border border-slate-700 text-xs text-slate-400">
                            Face must be visible at all times. Audio is being monitored for multiple voices.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold text-slate-800">Mock Interview Simulator</h2>
                <p className="text-slate-500">Timed assessments with AI proctoring.</p>
            </div>

            {testFinished ? (
                <div className="bg-white p-12 rounded-2xl shadow-lg border border-slate-200 text-center max-w-2xl mx-auto">
                    <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6">
                         {score > 2 ? <CheckCircle className="h-10 w-10 text-green-500" /> : <XCircle className="h-10 w-10 text-orange-500" />}
                    </div>
                    <h3 className="text-2xl font-bold text-slate-800 mb-2">Interview Completed</h3>
                    <p className="text-slate-500 mb-8">You scored <strong className="text-indigo-600 text-xl">{score} / {questions.length}</strong></p>
                    
                    <div className="grid grid-cols-2 gap-4 text-left bg-slate-50 p-6 rounded-xl mb-8">
                        <div>
                            <p className="text-xs text-slate-400 uppercase font-bold">Round</p>
                            <p className="font-semibold">{roundType}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 uppercase font-bold">Performance</p>
                            <p className={`font-semibold ${score > 3 ? 'text-green-600' : 'text-orange-600'}`}>
                                {score > 4 ? "Excellent" : score > 2 ? "Good" : "Needs Improvement"}
                            </p>
                        </div>
                    </div>
                    
                    <button onClick={() => setTestFinished(false)} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700">
                        Take Another Test
                    </button>
                </div>
            ) : (
                <div className="grid md:grid-cols-2 gap-8 items-start">
                    {/* Config Panel */}
                    <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
                        <div className="space-y-4">
                            <div>
                                <label className="font-bold text-slate-700 block mb-2 bg-white text-slate-900">Round Type</label>
                                <div className="flex flex-wrap gap-2">
                                    {ROUND_TYPES.map(t => (
                                        <button 
                                            key={t} onClick={() => { setRoundType(t); setTopic(TOPICS[t as keyof typeof TOPICS][0]); }}
                                            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                                                roundType === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                            }`}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="font-bold text-slate-700 block mb-2 bg-white text-slate-900">Focus Topic</label>
                                <select 
                                    value={topic} onChange={(e) => setTopic(e.target.value)}
                                    className="w-full p-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    {TOPICS[roundType as keyof typeof TOPICS].map(t => <option key={t}>{t}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className="font-bold text-slate-700 block mb-2 bg-white text-slate-900">Difficulty</label>
                                <select 
                                    value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
                                    className="w-full p-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option>Beginner</option>
                                    <option>Intermediate</option>
                                    <option>Advanced</option>
                                </select>
                            </div>
                        </div>

                        <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-100 text-sm text-yellow-800 space-y-2">
                             <p className="font-bold flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Proctoring Rules</p>
                             <ul className="list-disc pl-4 space-y-1">
                                 <li>Full screen mode is mandatory.</li>
                                 <li>Tab switching triggers <strong>immediate termination</strong>.</li>
                                 <li>Camera and Microphone must be on.</li>
                             </ul>
                        </div>

                        <button 
                            onClick={startTest}
                            disabled={loading}
                            className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-slate-800 transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {loading ? "Generating Quiz..." : "Start Interview"}
                        </button>
                    </div>

                    {/* Preview / Instructions */}
                    <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white p-8 rounded-2xl shadow-xl relative overflow-hidden min-h-[400px] flex flex-col justify-between">
                         <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 opacity-20 rounded-full blur-3xl -mr-16 -mt-16"></div>
                         
                         <div>
                             <h3 className="text-2xl font-bold mb-4">System Check</h3>
                             <div className="space-y-4">
                                 <div className="flex items-center justify-between bg-white/10 p-3 rounded-lg backdrop-blur-sm">
                                     <div className="flex items-center gap-3">
                                         <Video className="h-5 w-5 text-indigo-300" />
                                         <span>Camera Access</span>
                                     </div>
                                     {hasPermissions ? <CheckCircle className="h-5 w-5 text-green-400" /> : <button onClick={requestPermissions} className="text-xs bg-indigo-600 px-2 py-1 rounded hover:bg-indigo-700">Allow</button>}
                                 </div>
                                 <div className="flex items-center justify-between bg-white/10 p-3 rounded-lg backdrop-blur-sm">
                                     <div className="flex items-center gap-3">
                                         <Mic className="h-5 w-5 text-indigo-300" />
                                         <span>Microphone Access</span>
                                     </div>
                                     {hasPermissions ? <CheckCircle className="h-5 w-5 text-green-400" /> : <span className="text-xs text-slate-400">Waiting</span>}
                                 </div>
                                 <div className="flex items-center justify-between bg-white/10 p-3 rounded-lg backdrop-blur-sm">
                                     <div className="flex items-center gap-3">
                                         <Maximize className="h-5 w-5 text-indigo-300" />
                                         <span>Fullscreen Capable</span>
                                     </div>
                                     <CheckCircle className="h-5 w-5 text-green-400" />
                                 </div>
                             </div>
                         </div>

                         <div className="mt-8">
                             <div className="flex gap-4">
                                 <div className="w-1/2 bg-black/30 rounded-lg p-2 aspect-video flex items-center justify-center border border-white/10 overflow-hidden">
                                     <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover rounded" />
                                     {!hasPermissions && <span className="text-xs text-slate-400 absolute">Camera Off</span>}
                                 </div>
                                 <div className="w-1/2 flex flex-col justify-end text-sm text-slate-300">
                                     <p>Ensure you are in a well-lit room.</p>
                                     <p>No other people should be visible.</p>
                                 </div>
                             </div>
                         </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Interview;
