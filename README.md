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

## Docker Deployment

This project includes a production-ready Docker setup for the custom `server.js` runtime.

### Files

- `Dockerfile` — multi-stage production image
- `.dockerignore` — smaller, cleaner build context
- `docker-compose.yml` — app + MongoDB deployment config
- `deploy/nginx/monitor.eaqdragon.com.conf` — nginx reverse proxy for the domain

### Server Setup

1. Copy the project to your server.
2. Create or upload your `.env` file.
3. Build and start the containers:

```bash
docker compose up -d --build
```

This setup starts:

- `nginx` on `80`
- `monitor` on `127.0.0.1:3010`
- `mongo` on `127.0.0.1:27018` for host access
- `mongo` with database `monitor`

MongoDB credentials used by the app:

- Database: `monitor`
- Username: `monitor`
- Password: `AaBb1234!`

### Updating on Server

After pushing new code to the server:

```bash
docker compose up -d --build
```

### Notes

- The app listens on port `3000` inside the container.
- `nginx` listens on port `80` in Docker and proxies requests to `monitor:3000` over the Docker network.
- `docker-compose.yml` maps `127.0.0.1:3010:3000` so nginx can proxy it safely without using host port `3000`.
- `.env` is injected at runtime via `env_file`, so secrets are not baked into the image.
- `db-config.json` is bind-mounted to `/app/db-config.json` so Settings changes survive container restarts.
- MongoDB data is stored in the Docker volume `mongo_data`.
- MongoDB still listens on `27017` inside Docker, but is exposed as `127.0.0.1:27018` on the host to avoid host port conflicts.

### Nginx

For Docker Compose deployments, nginx runs as a container using `deploy/nginx/docker/default.conf`.

If you prefer host-level nginx instead, a host config is included at `deploy/nginx/monitor.eaqdragon.com.conf`.

Typical host-level nginx server steps:

```bash
sudo cp deploy/nginx/monitor.eaqdragon.com.conf /etc/nginx/sites-available/monitor.eaqdragon.com
sudo ln -s /etc/nginx/sites-available/monitor.eaqdragon.com /etc/nginx/sites-enabled/monitor.eaqdragon.com
sudo nginx -t
sudo systemctl reload nginx
```

If you use SSL with Certbot, run it after nginx is live:

```bash
sudo certbot --nginx -d monitor.eaqdragon.com
```

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
