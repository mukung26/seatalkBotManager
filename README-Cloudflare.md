# Transferring your Bot to Cloudflare & Firebase

To move your entire SeaTalk Bot application out of jcruspero3263 and host it on **Cloudflare** with **Firebase** as the database, you will split the project into two parts:

1. **The Backend Webhook (Cloudflare Workers)**: Handles incoming messages from SeaTalk, automatically replies to users, and saves chat history into Firebase Firestore.
2. **The Frontend Admin Dashboard (Cloudflare Pages)**: A React website where you can log in, view conversations, add auto-reply rules, and reply to users manually.

## Phase 1: Set up Firebase

1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Go to **Firestore Database** in the left menu and click **Create database**. Start in **Test mode** for now.
3. Go to **Project Settings** (the gear icon) > **General**. 
4. Scroll down to "Your apps" and select the **Web** icon `</>` to create a web app. Register it and copy the `firebaseConfig` object (you will need the `projectId` and `apiKey`).

## Phase 2: Deploying the Backend to Cloudflare Workers

1. Go to your [Cloudflare Dashboard](https://dash.cloudflare.com/), navigate to **Workers & Pages**, and click **Create Application** > **Create Worker**.
2. Name it `seatalk-bot-webhook` and deploy.
3. Click **Edit code** and replace the default code with the contents of the `cloudflare-worker.js` file provided in this workspace.
4. Click **Deploy**.
5. Go to the Worker's **Settings** > **Variables and Secrets**. Add the following variables:
   - `SEATALK_APP_ID`: Your SeaTalk App ID
   - `SEATALK_APP_SECRET`: Your SeaTalk App Secret
   - `SEATALK_EVENT_SECRET`: Your SeaTalk Event Callback Secret
   - `FIREBASE_PROJECT_ID`: Your Firebase Project ID (from the Firebase Config)
   - `FIREBASE_API_KEY`: Your Firebase Web API Key (from the Firebase Config)
6. Copy the URL of your new Cloudflare Worker (e.g., `https://seatalk-bot-webhook.yourname.workers.dev`).
7. **Important:** Go to the SeaTalk Developer Portal, find your app, go to **Event Callback**, and paste your worker URL (e.g., `https://seatalk-bot-webhook.yourname.workers.dev/api/seatalk`) into the webhook field to verify it.

## Phase 3: Deploying the Frontend Dashboard to Cloudflare Pages

1. In your project (you can download the files from jcruspero3263 using the "Export" button in settings), open `src/lib/firebase.ts` and replace the placeholder config with your actual Firebase config.
2. Open your terminal on your computer and run:
   ```bash
   npm install
   npm run build
   ```
   This will generate a `dist` folder.
3. Go back to the **Cloudflare Dashboard** > **Workers & Pages** > **Create Application** > **Pages** > **Upload assets**.
4. Name your project (e.g., `seatalk-dashboard`) and upload the entire `dist` folder you just generated.
5. Cloudflare will deploy your React website for free!

You now have a fully serverless architecture with 0 running costs. Your SeaTalk Bot runs on Cloudflare Workers, your website is globally distributed on Cloudflare Pages, and all chats are securely stored in Firebase!
