
import React, { useState, useEffect, useRef } from 'react';
import { sendMessageToMentor } from '../services/geminiServices';
import { Message } from '../types';
import { Send, Bot, User, Globe, Mic, Volume2, StopCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const Mentor: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'model', text: 'Hello! I am your AI Teaching Assistant. I can explain complex concepts, help with assignments, or clarify doubts in English or your regional language.', timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('English');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Audio: Stop speaking when component unmounts
  useEffect(() => {
      return () => {
          window.speechSynthesis.cancel();
      };
  }, []);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
        const history = messages.map(m => ({
            role: m.role,
            parts: [{ text: m.text }]
        }));

        const responseText = await sendMessageToMentor(history, input, language);
        
        const botMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'model',
            text: responseText,
            timestamp: new Date()
        };
        setMessages(prev => [...prev, botMsg]);
        
        // Auto-speak response if mic was used (optional, but good UX)
        // speak(responseText); 
    } catch (error: any) {
        console.error('Chat error:', error);
        // Show error message to user
        const errorMsg: Message = {
            id: (Date.now() + 2).toString(),
            role: 'model',
            text: 'Sorry, I encountered an error. Please try again.',
            timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMsg]);
    } finally {
        setLoading(false);
    }
  };

  const startListening = () => {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
          alert("Your browser does not support speech recognition.");
          return;
      }

      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      const recognition = new SpeechRecognition();
      
      // Map basic languages to locale codes
      const langMap: {[key: string]: string} = {
          'English': 'en-US',
          'Hindi': 'hi-IN',
          'Spanish': 'es-ES',
          'French': 'fr-FR',
          'Tamil': 'ta-IN',
          'Telugu': 'te-IN'
      };
      
      recognition.lang = langMap[language] || 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = (event: any) => {
          console.error("Speech error", event.error);
          setIsListening(false);
      };

      recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setInput(transcript);
      };

      recognition.start();
  };

  const speak = (text: string) => {
      if (isSpeaking) {
          window.speechSynthesis.cancel();
          setIsSpeaking(false);
          return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      // Clean up markdown roughly for speech
      utterance.text = text.replace(/[*#]/g, '');
      
      // Attempt to set voice/lang
       const langMap: {[key: string]: string} = {
          'English': 'en-US',
          'Hindi': 'hi-IN',
          'Spanish': 'es-ES',
          'French': 'fr-FR',
          'Tamil': 'ta-IN',
          'Telugu': 'te-IN'
      };
      utterance.lang = langMap[language] || 'en-US';

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] flex flex-col p-4 md:p-6 max-w-5xl mx-auto">
      <div className="bg-white rounded-t-xl shadow-sm border border-slate-200 p-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <Bot className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800">AI Teaching Assistant</h2>
            <p className="text-xs text-slate-500">Always online • Explains in multiple languages</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-slate-400" />
            <select 
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="text-sm border-none bg-slate-50 rounded-md focus:ring-0 text-slate-600 font-medium cursor-pointer"
            >
                <option>English</option>
                <option>Hindi</option>
                <option>Spanish</option>
                <option>French</option>
                <option>Tamil</option>
                <option>Telugu</option>
            </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50 p-4 space-y-4 border-x border-slate-200">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex items-start gap-3 max-w-[85%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
              {msg.role === 'user' ? <User className="h-5 w-5 text-white" /> : <Bot className="h-5 w-5 text-white" />}
            </div>
            <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${
              msg.role === 'user' 
                ? 'bg-indigo-600 text-white rounded-tr-none' 
                : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none'
            }`}>
              {msg.role === 'model' ? (
                  <div className="prose prose-sm prose-slate max-w-none">
                      <ReactMarkdown 
                        components={{
                            ul: ({node, ...props}) => <ul className="list-disc pl-4 my-1 space-y-0.5" {...props} />,
                            li: ({node, ...props}) => <li className="my-0" {...props} />,
                            p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />
                        }}
                      >
                          {msg.text}
                      </ReactMarkdown>
                      <button 
                        onClick={() => speak(msg.text)}
                        className={`mt-2 p-1.5 rounded-full hover:bg-slate-100 transition-colors ${isSpeaking ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}
                        title="Read Aloud"
                      >
                          {isSpeaking ? <StopCircle className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                      </button>
                  </div>
              ) : msg.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-start gap-3">
             <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center shrink-0">
                <Bot className="h-5 w-5 text-white" />
             </div>
             <div className="bg-white p-4 rounded-2xl rounded-tl-none shadow-sm border border-slate-100">
                <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-100"></span>
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-200"></span>
                </div>
             </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="bg-white rounded-b-xl shadow-sm border border-slate-200 p-4">
        <div className="flex items-center gap-2 bg-white rounded-xl px-4 py-2 border border-slate-200 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition-all shadow-sm">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={isListening ? "Listening..." : "Ask a doubt, request materials, or ask for an explanation..."}
            className="flex-1 bg-white border-none focus:ring-0 text-slate-900 placeholder-slate-400"
          />
          <button 
            onClick={startListening}
            className={`p-2 rounded-full transition-all ${isListening ? 'bg-red-100 text-red-600 animate-pulse' : 'hover:bg-slate-100 text-slate-500'}`}
            title="Speak Input"
          >
            <Mic className="h-5 w-5" />
          </button>
          <button 
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Mentor;
