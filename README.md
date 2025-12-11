# EduBridge - Engineering to MNC Bridge

A comprehensive platform connecting engineering students with MNC opportunities through AI-powered tools and resources.

## Features

- **Dashboard**: Overview of your progress and activities
- **Tech Accelerator**: Company-specific fit analysis
- **Scholar (IIT/NIT)**: Internship opportunity matching
- **Smart Timetable**: AI-generated study schedules
- **AI Mentor**: Educational assistant chatbot
- **Industry Lab Guide**: Step-by-step lab experiment workflows
- **Notes Converter**: Convert content to structured revision notes
- **Skill Gap Analysis**: Analyze resume against target roles
- **Project Generator**: Generate final year project ideas
- **Mock Interview**: Practice with MCQ quizzes
- **Peer Match**: Connect with like-minded peers
- **MNC Trends**: Latest technology trends in MNCs
- **Parent Portal**: Generate progress reports for parents

## Setup Instructions

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn package manager

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   - Copy `.env.example` to `.env`
   - Add your Google Gemini API key:
     ```
     VITE_API_KEY=your_api_key_here
     ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

   The application will open at `http://localhost:3000`

### Build for Production

```bash
npm run build
```

The production build will be in the `dist` folder.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
GVP/
├── component/          # React components
├── services/           # API services (Gemini AI)
├── src/               # Styles and assets
├── App.tsx            # Main application component
├── index.tsx          # Application entry point
├── index.html         # HTML template
├── types.ts           # TypeScript type definitions
└── package.json       # Dependencies and scripts
```

## Technologies Used

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **Google Gemini AI** - AI services
- **Lucide React** - Icons
- **Recharts** - Data visualization
- **React Markdown** - Markdown rendering

## Environment Variables

- `VITE_API_KEY`: Your Google Gemini API key (required for AI features)

## Development

The project uses Vite for fast development with hot module replacement (HMR). Any changes you make will automatically reflect in the browser.

## License

MIT

