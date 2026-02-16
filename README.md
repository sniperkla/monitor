# SSH Monitor & Terminal

A modern, web-based SSH terminal and server monitoring dashboard built with Next.js, Tailwind CSS, and MongoDB.

## Features

- 🖥️ **Web-based SSH Terminal**: Full-featured xterm.js terminal with resizing and real-time WebSocket communication.
- 📊 **Dashboard**: Visual overview of your server status (Online/Offline).
- 🔑 **Key Management**: Support for private key (.pem, .ppk) and password authentication.
- 🎨 **Modern UI**: Premium dark theme with glassmorphism effects.
- 🏷️ **Organization**: Tag, color code, and search your connections.
- 📁 **File Upload**: Drag-and-drop private keys securely.
- ⚡ **Real-time**: WebSocket-based sessions and live status updates.

## Prerequisites

- **Node.js** (v18 or higher)
- **MongoDB** (Ensure `mongod` is running locally or provide a URI)

## Getting Started

1.  **Install Dependencies**

    ```bash
    npm install
    ```

2.  **Environment Setup**

    Create a `.env` file in the root directory (already created):

    ```ini
    MONGODB_URI=mongodb://localhost:27017/ssh-monitor
    PORT=3000
    ```

3.  **Run Development Server**

    ```bash
    npm run dev
    ```

    > **Note**: This uses a custom `server.js` to handle WebSocket connections for the SSH terminal.

4.  **Open in Browser**

    Navigate to [http://localhost:3000](http://localhost:3000).

## Usage

1.  Click **"Add Server"** (or "New Connection") to add a new SSH host.
2.  Enter the **Host**, **Port**, **Username**, and choose **Password** or **Private Key**.
3.  Click **Save**.
4.  Double-click the connection in the sidebar or click the **Connect** icon to open a terminal tab.

## Technologies

- **Frontend**: Next.js 14, Tailwind CSS, Lucide Icons, React Hot Toast
- **Backend**: Custom Node.js server (Express-like) with Next.js
- **Database**: MongoDB (Mongoose)
- **SSH/Terminal**: ssh2, socket.io, xterm.js

## License

MIT
# monitor
