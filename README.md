# CommitDesk

CommitDesk is a browser-only meeting commitment tracker built with React, TypeScript, and Vite. Task data and chat history are stored in the browser's local storage. No backend or external task database is used.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`; run the configured linter with `npm run lint`.

## Task extraction

The app works without an API key using a small local parser for clear assignments, basic task commands, and overdue queries. This mode has limited natural-language understanding and labels its responses accordingly.

For Gemini extraction, open **Settings**, paste a Gemini API key, and save. The key is kept in memory unless the explicit local-storage option is enabled. A saved key remains in the browser and is not protected like a server-side secret. When enabled, the browser sends the submitted message and current task titles, assignees, due dates, and statuses directly to the configured Gemini API for parsing and action matching; other task details are not included.

## Persistence and demo data

Tasks, conversation history, and optionally the Gemini key persist in local storage. Demo tasks initialize only when no valid task list is already stored. Use **Restore demo** to replace the current task list with the original sample dataset.

The application is frontend-only and does not configure a hosting provider. To publish it, build the app and deploy the generated `dist/` directory to a static hosting provider.
