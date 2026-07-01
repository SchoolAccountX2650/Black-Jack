# Blackjack Academy - AI Agent Log

## Project Overview
This project is an AI-powered Blackjack Academy application designed to help players learn and practice Basic Strategy.

## Implementation Details

### Stack & Technologies
- Frontend: React 19, Tailwind CSS v4, Recharts
- Backend: Express.js, Vite Dev Server middleware
- AI Integration: `@google/genai` (Server-side)
- Model: `gemini-3.1-flash-lite`

### Key Features Implemented
1. **Interactive Blackjack Game**:
   - Standard 52-card deck with shuffle mechanism (`src/gameLogic.ts`).
   - Standard blackjack rules for hitting, standing, and dealer actions.
2. **Immersive UI**:
   - Dark theme, high contrast aesthetic.
   - Analytics dashboard on the left sidebar (Win/Loss distribution, Recharts bar chart).
   - Card rendering with simple animations.
3. **AI Strategy Engine (Gemini 3.1 Flash Lite)**:
   - **Real-time Advice**: Analyzes player choices (Hit/Stand) against Basic Strategy and gives immediate feedback using the `/api/gemini/advice` endpoint.
   - **Tactic Mode**: Offers beginner hints (displaying the optimal action) before they make a move.
   - **Analysis Report**: Analyzes the past 10 hands and generates a summary of strengths and weaknesses via the `/api/gemini/report` endpoint.
4. **Tutorial Mode**:
   - Displays a welcome/learning mode message on the first load, which the user can easily bypass.
5. **Full-stack Configuration**:
   - `server.ts` configured as an Express server handling API requests.
   - `package.json` modified to run `tsx server.ts` for local development.

### Notes for Future AI Modifiers
- The Gemini API is strictly limited to server-side execution for security (`server.ts`). Do NOT expose API keys to the React frontend.
- `src/gameLogic.ts` contains the pure logic for card values and the simplified Basic Strategy logic.
- `App.tsx` handles the main UI layout, state management, and API calls to the local Express server.
- The UI strictly adheres to a single-view constraint without complex routing or navigation menus.
