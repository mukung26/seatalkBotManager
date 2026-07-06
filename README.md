# SeaTalk Bot Manager

A comprehensive full-stack management dashboard for SeaTalk bots. This application provides a powerful graphical interface to manage interactions, configure auto-replies, schedule background broadcasts, and monitor real-time conversations for your SeaTalk integrations.

## Features

- **Interactive Message Card Builder:** Visually build and test SeaTalk Interactive Messages using a drag-and-drop interface and JSON editor.
- **Auto-Reply Rules:** Configure keyword-based or fallback automated replies for incoming messages without writing code.
- **Broadcasts & Scheduler:** Send immediate or scheduled announcements to individual users or groups across your organization.
- **Live Conversation Dashboard:** Monitor and respond manually to real-time chats with users on SeaTalk.
- **Google Sheets Integration:** Automatically log messages and activities directly to a connected Google Spreadsheet via OAuth.
- **Fully Serverless Ready:** Designed to be decoupled into a Cloudflare Pages frontend and a Cloudflare Workers backend webhook.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React (Icons).
- **Backend:** Firebase (Firestore & Auth) for data persistence.
- **State Management:** Zustand.
- **Deployment Strategy:** Supports Cloud Run, Node.js, and serverless edge deployment (Cloudflare).

## Setup & Local Development

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Copy the `.env.example` file to `.env` and configure your credentials.
   ```bash
   cp .env.example .env
   ```
   *Note: Ensure your Firebase configuration is properly set in `src/lib/firebase.ts`.*

3. **Start Development Server:**
   ```bash
   npm run dev
   ```

4. **Build for Production:**
   ```bash
   npm run build
   ```

## Architecture & Deployment

This project consists of two primary parts:
1. **The Dashboard (Frontend):** A React SPA for managing bot configuration, templates, and schedules.
2. **The Webhook (Backend):** Handles incoming SeaTalk events, processes auto-replies, and logs conversations to Firebase.

For detailed instructions on migrating this project to a serverless architecture, see [README-Cloudflare.md](./README-Cloudflare.md).

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
